import { clickhouse } from "@/lib/analytics";
import { createSubscriber, liveChannel } from "@/lib/redis";
import { resolveProjectForUser } from "@/lib/tenancy";
import { recentEvents } from "@tracki/clickhouse";

export const dynamic = "force-dynamic";

/**
 * SSE stream of live events for a project. Tenancy-guarded: only a member of
 * the org that owns the project can subscribe. Each connection gets its own
 * Redis subscriber, torn down on disconnect.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectSlug: string }> },
) {
  const { orgSlug, projectSlug } = await params;
  const ref = await resolveProjectForUser(orgSlug, projectSlug);
  if (!ref) return new Response("Not found", { status: 404 });

  const channel = liveChannel(ref.projectId);
  const sub = createSubscriber();
  const encoder = new TextEncoder();
  let reauthTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const onMessage = (_ch: string, message: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        } catch {
          /* stream closed */
        }
      };
      sub.on("message", onMessage);
      await sub.subscribe(channel);
      // Initial comment so the client's onopen fires promptly.
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Backfill recent history so the feed isn't empty on open (events that
      // arrived before this connection). Subscribe-then-backfill + the client's
      // event_id dedup makes any overlap with live frames harmless. The CH
      // timestamp is UTC text; convert to epoch ms to match live frames. Sent
      // oldest→newest so the client's prepend lands the newest on top.
      try {
        const rows = await recentEvents(clickhouse(), ref.orgId, ref.projectId, 50);
        for (const r of rows.reverse()) {
          const ms = Date.parse(`${r.ts.replace(" ", "T")}Z`);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                event_id: r.event_id,
                type: r.type,
                path: r.path,
                anon_id: r.anon_id,
                user_id: r.user_id,
                session_id: r.session_id,
                ts: Number.isNaN(ms) ? undefined : ms,
              })}\n\n`,
            ),
          );
        }
      } catch {
        /* CH unavailable — live-only stream is still useful */
      }

      // Audit M2: re-validate membership periodically — a revoked/logged-out
      // member must stop receiving the stream, not keep it until they close it.
      reauthTimer = setInterval(async () => {
        const still = await resolveProjectForUser(orgSlug, projectSlug);
        if (!still || still.projectId !== ref.projectId) {
          if (reauthTimer) clearInterval(reauthTimer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }, 30_000);
    },
    async cancel() {
      if (reauthTimer) clearInterval(reauthTimer);
      await sub.unsubscribe(channel).catch(() => {});
      await sub.quit().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
