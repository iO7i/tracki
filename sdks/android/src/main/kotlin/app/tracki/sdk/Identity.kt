package app.tracki.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.util.UUID

const val ANON_KEY = "tracki_anon"
const val USER_KEY = "tracki_user"
const val SESSION_KEY = "tracki_session"
const val SESSION_TS_KEY = "tracki_session_ts"

/** Same rotation rule as the web snippet: 30 min of inactivity = new session. */
const val SESSION_TIMEOUT_MS: Long = 30 * 60 * 1000

/** Default id factory; `prefix_<uuid>`. */
fun defaultIdFactory(prefix: String): String = "${prefix}_${UUID.randomUUID()}"

/**
 * Visitor identity over an injected async store. Hydrated once at init; all
 * reads are then synchronous in-memory, writes persist fire-and-forget on the
 * provided [scope] (the memory copy is authoritative for the process lifetime —
 * mirroring the reference's localStorage-with-memory-fallback semantics).
 */
class Identity(
    private val storage: KeyValueStorage,
    private val now: Clock,
    private val scope: CoroutineScope,
    private val newId: IdFactory = ::defaultIdFactory,
) {
    private var anonId = ""
    private var userId: String? = null
    private var sessionId = ""
    private var lastActivity = 0L

    /** Load persisted identity; create what's missing. Call once before use. */
    suspend fun hydrate() {
        val (anon, user, sess, ts) = coroutineScope {
            val a = async { runCatching { storage.get(ANON_KEY) }.getOrNull() }
            val u = async { runCatching { storage.get(USER_KEY) }.getOrNull() }
            val s = async { runCatching { storage.get(SESSION_KEY) }.getOrNull() }
            val t = async { runCatching { storage.get(SESSION_TS_KEY) }.getOrNull() }
            val r = awaitAll(a, u, s, t)
            Quad(r[0], r[1], r[2], r[3])
        }
        anonId = if (!anon.isNullOrEmpty()) anon else persist(ANON_KEY, newId("anon"))
        userId = if (!user.isNullOrEmpty()) user else null
        sessionId = sess ?: ""
        lastActivity = ts?.toLongOrNull() ?: 0L
        // Ensure a valid session exists (also rotates an expired persisted one).
        touchSession()
    }

    private fun persist(key: String, value: String): String {
        scope.launch { runCatching { storage.set(key, value) } }
        return value
    }

    fun getAnonId(): String = anonId

    fun getUserId(): String? = userId

    fun setUserId(userId: String) {
        this.userId = userId
        persist(USER_KEY, userId)
    }

    /** Current session id; rotates after 30 min of inactivity, stamps activity. */
    fun touchSession(): String {
        val t = now()
        if (sessionId.isEmpty() || t - lastActivity > SESSION_TIMEOUT_MS) {
            sessionId = persist(SESSION_KEY, newId("sess"))
        }
        lastActivity = t
        persist(SESSION_TS_KEY, t.toString())
        return sessionId
    }

    /** Read without stamping activity (used when building batches). */
    fun currentSession(): String = sessionId

    private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)
}
