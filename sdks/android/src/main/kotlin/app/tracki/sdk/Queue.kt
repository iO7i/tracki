package app.tracki.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Same cadence as the web snippet. */
const val FLUSH_SIZE = 10
const val FLUSH_INTERVAL_MS = 5000L

/** /v1/events caps a batch at 50 events — split larger buffers. */
private const val MAX_BATCH = 50

/**
 * Buffers events and flushes on size / interval / app-background. The ingest
 * response may carry a pending Live Assist — surfaced via the response handler.
 */
class EventQueue(
    private val key: String,
    private val eventsUrl: String,
    private val identity: Identity,
    private val device: DeviceInfo,
    private val transport: Transport,
    private val now: Clock,
    private val scope: CoroutineScope,
) {
    private val buffer = ArrayList<EventInput>()
    private var timer: Job? = null
    private var onResponse: ((Any?) -> Unit)? = null
    /** Serializes flushes so batches arrive in order (mirrors the TS inflight chain). */
    private var inflight: Job = scope.launch { }

    fun setResponseHandler(fn: (Any?) -> Unit) {
        onResponse = fn
    }

    fun enqueue(event: EventInput) {
        identity.touchSession()
        val count: Int
        synchronized(buffer) {
            buffer.add(event)
            count = buffer.size
        }
        if (count >= FLUSH_SIZE) {
            flush()
        } else if (timer == null) {
            timer = scope.launch {
                delay(FLUSH_INTERVAL_MS)
                flush()
            }
        }
    }

    /** Send everything buffered. Serialized so batches arrive in order. */
    fun flush(): Job {
        timer?.cancel()
        timer = null
        val events: List<EventInput>
        synchronized(buffer) {
            if (buffer.isEmpty()) return inflight
            events = ArrayList(buffer)
            buffer.clear()
        }
        val prev = inflight
        val next = scope.launch {
            prev.join()
            var i = 0
            while (i < events.size) {
                val end = minOf(i + MAX_BATCH, events.size)
                val batch = Batch(
                    key = key,
                    anonId = identity.getAnonId(),
                    userId = identity.getUserId(),
                    sessionId = identity.currentSession(),
                    sentAt = now(),
                    device = device,
                    events = events.subList(i, end),
                )
                val data = runCatching { transport.post(eventsUrl, batch.toJson()) }.getOrNull()
                // fail-silent: behavioral telemetry must never break the host app.
                if (data != null) onResponse?.invoke(data)
                i += MAX_BATCH
            }
        }
        inflight = next
        return next
    }

    /** Await-friendly flush mirroring the reference's `flush(): Promise<void>`. */
    suspend fun flushAndJoin() {
        flush().join()
    }

    /** Test helper. */
    val size: Int
        get() = synchronized(buffer) { buffer.size }
}
