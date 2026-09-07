import { createSubscriber } from "@/lib/redis";
import { resolveProjectForUser } from "@/lib/tenancy";

export const dynamic = "force-dynamic";

/**
 * SSE stream of live struggle detections for a project. Same tenancy posture as
 * the events live stream: member-only, re-validated every 30s (Audit M2).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgSlug: string; projectSlug: string }> },
) {
  const { orgSlug, projectSlug } = await params;
  const ref = await resolveProjectForUser(orgSlug, projectSlug);
  if (!ref) return new Response("Not found", { status: 404 });

  const channel = `struggles:${ref.projectId}`;
  const sub = createSubscriber();
  const encoder = new TextEncoder();
  let reauthTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      sub.on("message", (_ch, message) => {
        try {
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        } catch {
          /* closed */
        }
      });
      await sub.subscribe(channel);
      controller.enqueue(encoder.encode(": connected\n\n"));

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
