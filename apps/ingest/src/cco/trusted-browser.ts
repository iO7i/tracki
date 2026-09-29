import { type EventBatch, type StoredEvent, eventBatchSchema } from "@tracki/shared";
import { acceptEvents } from "../inbox";
import { normalizeBatch } from "../normalize";
import { pg } from "../pg";
import type { Project } from "./config";
import { CcoError, correlationId, id, integer, object, safeRoute } from "./contract";
export type TrustedBrowserScope = {
  orgId: string;
  projectId: string;
  accountId: string;
  installationId: string | null;
  generation: number | null;
};
const types = new Set([
  "pageview",
  "route_change",
  "click",
  "form_focus",
  "form_submit",
  "form_abandon",
  "error",
  "page_leave",
  "track",
]);
/** Only a server producer credential can invoke this path. The browser's own account properties are ignored. */
export function parseTrustedBrowser(
  value: unknown,
  project: Project,
  now = Date.now(),
): { batch: EventBatch; scope: TrustedBrowserScope } {
  const body = object(value);
  const binding = object(body.binding);
  const raw = object(body.batch);
  const authorizedAt = integer(body.authorizedAt, now - 23 * 3600000, now + 120000);
  const validFrom = integer(binding.validFrom, now - 24 * 3600000, authorizedAt + 120000);
  const expiresAt = integer(binding.expiresAt, authorizedAt, authorizedAt + 16 * 60000);
  if (binding.actorKind !== "human") throw new CcoError("browser_human_binding_required");
  if (
    correlationId(binding.anonId) !== raw.anonId ||
    correlationId(binding.sessionId) !== raw.sessionId
  )
    throw new CcoError("browser_binding_mismatch", 409);
  const scope = {
    orgId: project.orgId,
    projectId: project.projectId,
    accountId: id(binding.accountId),
    installationId: binding.installationId == null ? null : id(binding.installationId),
    generation: binding.generation == null ? null : integer(binding.generation),
  };
  const parsed = eventBatchSchema.safeParse({
    ...raw,
    key: "cco_server_verified",
    userId: undefined,
    device: undefined,
  });
  if (!parsed.success) throw new CcoError("invalid_browser_batch");
  const batch = parsed.data;
  for (const event of batch.events) {
    if (
      !types.has(event.type) ||
      !event.eventId ||
      event.ts < validFrom ||
      event.ts >= expiresAt ||
      event.ts > authorizedAt + 120000
    )
      throw new CcoError("browser_event_outside_binding");
    const p = event.props ?? {};
    const props: Record<string, unknown> = {};
    if (event.type === "track") {
      if (!["cco_request", "cco_response", "cco_network_failure"].includes(String(p.name)))
        throw new CcoError("invalid_browser_track_name");
      props.name = p.name;
    }
    if (typeof p.tag === "string" && /^[a-z]{1,20}$/.test(p.tag)) props.tag = p.tag;
    if (
      typeof p.statusCode === "number" &&
      Number.isInteger(p.statusCode) &&
      p.statusCode >= 100 &&
      p.statusCode <= 599
    )
      props.statusCode = p.statusCode;
    if (event.type === "error") props.code = "CLIENT_ERROR";
    event.path = safeRoute(event.path) ?? "/";
    event.props = props;
    event.url = undefined;
    event.referrer = undefined;
  }
  return { batch, scope };
}
export async function acceptTrustedBrowser(
  value: unknown,
  project: Project,
  accept: (events: StoredEvent[], scope: TrustedBrowserScope) => Promise<unknown> = (
    events,
    scope,
  ) => acceptEvents(events, pg(), scope),
) {
  const now = Date.now();
  const parsed = parseTrustedBrowser(value, project, now);
  const normalized = normalizeBatch(parsed.batch, project, "cco-first-party", now);
  await accept(normalized, parsed.scope);
  return { acceptedClientIds: parsed.batch.events.map((e) => e.eventId) };
}
