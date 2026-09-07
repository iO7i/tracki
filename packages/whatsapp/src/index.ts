import { createHmac, timingSafeEqual } from "node:crypto";

export interface WhatsAppProvider {
  readonly name: string;
  /** Send a plain-text WhatsApp message to a wa_id (E.164 digits). */
  sendText(toWaId: string, text: string): Promise<void>;
}

/** Deterministic offline provider — records sends, no network. */
export class SimulatorProvider implements WhatsAppProvider {
  readonly name = "simulator";
  readonly sent: { to: string; text: string }[] = [];
  async sendText(toWaId: string, text: string): Promise<void> {
    this.sent.push({ to: toWaId, text });
  }
}

/** Meta Cloud API provider (used only when WHATSAPP_TOKEN is configured). */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta";
  constructor(
    private token: string,
    private phoneNumberId: string,
    private version = process.env.WHATSAPP_API_VERSION ?? "v21.0",
  ) {}

  async sendText(toWaId: string, text: string): Promise<void> {
    const res = await fetch(
      `https://graph.facebook.com/${this.version}/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toWaId,
          type: "text",
          text: { body: text },
        }),
      },
    );
    if (!res.ok) throw new Error(`whatsapp ${res.status}`);
  }
}

let cached: WhatsAppProvider | null = null;

export function getProvider(): WhatsAppProvider {
  if (cached) return cached;
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  cached =
    process.env.WHATSAPP_PROVIDER === "meta" && token && phoneId
      ? new MetaCloudProvider(token, phoneId)
      : new SimulatorProvider();
  return cached;
}

export function isSimulator(): boolean {
  return getProvider().name === "simulator";
}

/** Test seam. */
export function __setProvider(p: WhatsAppProvider | null): void {
  cached = p;
}

/**
 * Verify a Meta webhook signature (X-Hub-Signature-256: sha256=<hex>). When no
 * app secret is configured (dev), accepts — must be set in production.
 */
export function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    // Audit B1: FAIL CLOSED in Meta mode (a secretless prod must not accept
    // forged webhooks); accept only in dev/simulator where there's no real traffic.
    return process.env.WHATSAPP_PROVIDER !== "meta";
  }
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = signatureHeader.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export const BUSINESS_NUMBER = process.env.WHATSAPP_BUSINESS_NUMBER ?? "9665XXXXXXXX";

/**
 * Boot-time fail-closed check (Audit B1/B2): in Meta mode every credential must
 * be present, so partial config can't silently degrade to the simulator (which
 * would expose the simulate-inject endpoint) or accept unsigned webhooks.
 */
export function assertConfig(): void {
  if (process.env.WHATSAPP_PROVIDER !== "meta") return;
  for (const v of [
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_BUSINESS_NUMBER",
  ]) {
    if (!process.env[v]) {
      throw new Error(`WhatsApp: ${v} is required when WHATSAPP_PROVIDER=meta (refusing to start)`);
    }
  }
}

/** Simulate-inject is allowed only outside production AND in simulator mode. */
export function simulateAllowed(): boolean {
  return process.env.NODE_ENV !== "production" && isSimulator();
}
