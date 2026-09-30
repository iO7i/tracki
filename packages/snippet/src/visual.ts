import { record } from "@rrweb/record";
import type { Batch } from "./types";

/** Independent memory queue: a large snapshot must never evict ordinary causal events. */
export function installVisualCapture(
  send: (batch: Batch) => Promise<boolean>,
  identity: () => { anonId: string; sessionId: string },
  safePath: (url: string) => string,
): () => void {
  if (!window.CompressionStream) return () => {};
  const recordingId = crypto.randomUUID().replace(/-/g, "");
  let stopped = false;
  let sequence = 0;
  let busy = false;
  let bufferedBytes = 0;
  let retryAt = 0;
  let failures = 0;
  let events: unknown[] = [];
  const pending: Batch[] = [];
  let encoding = Promise.resolve();
  const clean = (value: unknown, attributes = false): unknown => {
    if (Array.isArray(value)) return value.map((v) => clean(v));
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (
        /^(?:__proto__|constructor|prototype)$/.test(key) ||
        (attributes &&
          /^(nonce|integrity|value|on\w+|data-.*(?:token|secret|credential|password))$/i.test(key))
      )
        continue;
      out[key] = key === "href" ? safePath(String(v)) : clean(v, key === "attributes");
    }
    return out;
  };
  const pump = async () => {
    const next = pending[0];
    if (busy || stopped || !next || Date.now() < retryAt) return;
    busy = true;
    try {
      if (await send(next)) {
        if (!stopped) bufferedBytes -= JSON.stringify(pending.shift()).length;
        failures = 0;
        retryAt = 0;
      } else {
        retryAt = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(++failures, 5));
      }
    } catch {
      retryAt = Date.now() + 30000;
    } finally {
      busy = false;
    }
  };
  const flush = () => {
    if (stopped || !events.length) return;
    const captured = events;
    events = [];
    const capturedSequence = sequence++;
    encoding = encoding
      .then(async () => {
        if (stopped) return;
        const json = JSON.stringify(captured);
        if (json.length > 8 * 1024 * 1024) {
          stop();
          return;
        }
        const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        if (stopped) return;
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const data = btoa(binary);
        const parts = Math.ceil(data.length / 6000);
        const segmentId = crypto.randomUUID().replace(/-/g, "");
        if (parts > 512) {
          stop();
          return;
        }
        const binding = identity();
        const ts = (captured[0] as { timestamp: number }).timestamp;
        for (let offset = 0; offset < parts; offset += 10) {
          const batch: Batch = { key: "cco-visual", ...binding, sentAt: Date.now(), events: [] };
          for (let part = offset; part < Math.min(parts, offset + 10); part++)
            batch.events.push({
              type: "track",
              eventId: `visual_${crypto.randomUUID().replace(/-/g, "")}`,
              ts,
              path: safePath(location.pathname),
              props: {
                name: "cco_visual_chunk",
                recordingId,
                segmentId,
                sequence: capturedSequence,
                part,
                parts,
                data: data.slice(part * 6000, (part + 1) * 6000),
              },
            });
          const size = JSON.stringify(batch).length;
          if (bufferedBytes + size > 8 * 1024 * 1024) {
            stop();
            return;
          }
          bufferedBytes += size;
          pending.push(batch);
        }
        await pump();
      })
      .catch(() => stop());
  };
  const stopRecording = record({
    emit(event) {
      if (stopped) return;
      events.push(clean(event));
      if (events.length >= 250) flush();
    },
    maskAllInputs: true,
    blockSelector: '[data-cco-private],.rr-block,input[type="password"],input[type="hidden"]',
    inlineStylesheet: true,
    inlineImages: true,
    recordCanvas: false,
    collectFonts: false,
    sampling: { mousemove: 100, scroll: 100 },
    checkoutEveryNms: 60000,
  });
  const timer = setInterval(() => {
    flush();
    void pump();
  }, 1000);
  const onHide = () => {
    flush();
    void pump();
  };
  window.addEventListener("pagehide", onHide);
  function stop() {
    stopped = true;
    stopRecording?.();
    clearInterval(timer);
    window.removeEventListener("pagehide", onHide);
    events = [];
    pending.length = 0;
    bufferedBytes = 0;
  }
  return stop;
}
