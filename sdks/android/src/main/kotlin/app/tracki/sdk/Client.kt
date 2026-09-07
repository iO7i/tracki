package app.tracki.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.async

private val WHITESPACE = Regex("\\s+")

/** "Checkout Screen" → "/Checkout-Screen"-style path key (case preserved). */
fun screenPath(name: String): String {
    val cleaned = name.trim().replace(WHITESPACE, "-")
    return if (cleaned.startsWith("/")) cleaned else "/$cleaned"
}

/** Reference holder exposing the current screen path to helper modules. */
internal class PathBox {
    @Volatile
    var path: String = "/"
}

/**
 * The Tracki mobile client. Hydrates identity from storage, then exposes a
 * fully synchronous tracking API (flushes are async + fail-silent). Emits the
 * cold app_foreground itself — one fewer thing for the host app to remember,
 * and the signal app_restart_loop detection needs.
 */
class TrackiClient internal constructor(
    private val now: Clock,
    private val identity: Identity,
    private val queue: EventQueue,
    private val cta: CtaRouter,
    private val engine: ActionEngine,
    private val pathBox: PathBox,
    /** Resolves when the action manifest finished loading (tests/bench). */
    val ready: Deferred<Unit>,
) {
    private var currentPath = "/"
    private var previousPath = ""
    private var screenEnteredAt = now()

    private fun emit(type: String, props: Map<String, Any?>? = null) {
        queue.enqueue(
            EventInput(
                type = type,
                ts = now(),
                path = currentPath,
                referrer = previousPath.ifEmpty { null },
                props = props,
            )
        )
    }

    internal fun emitColdStart() = emit("app_foreground", mapOf("launch" to "cold"))

    /** Screen tracking: emits screen_leave (with duration) + screen_view. */
    fun screen(name: String, props: Map<String, Any?>? = null) {
        val next = screenPath(name)
        if (currentPath != "/") {
            val d = now() - screenEnteredAt
            emit("screen_leave", mapOf("durationMs" to maxOf(0L, d)))
        }
        previousPath = if (currentPath == "/") "" else currentPath
        currentPath = next
        pathBox.path = next
        screenEnteredAt = now()
        emit("screen_view", props)
        engine.onScreen()
    }

    /** App lifecycle. The SDK already emitted the initial cold foreground. */
    fun appForeground(launch: String = "warm") = emit("app_foreground", mapOf("launch" to launch))

    fun appBackground() {
        val d = now() - screenEnteredAt
        emit("app_background", mapOf("durationMs" to maxOf(0L, d)))
        engine.onBackground()
        queue.flush()
    }

    fun appTerminate() {
        emit("app_terminate")
        queue.flush()
    }

    /** Navigation + entry points. */
    fun backNav() = emit("back_nav")

    fun deepLink(url: String, ok: Boolean = true) = emit("deep_link", mapOf("url" to url, "ok" to ok))

    fun pushOpen(props: Map<String, Any?>? = null) = emit("push_open", props)

    /** Auth + payment funnels. */
    fun otp(phase: String, props: Map<String, Any?>? = null) = emit("otp_$phase", props)
    fun biometric(phase: String, props: Map<String, Any?>? = null) = emit("biometric_$phase", props)
    fun payment(phase: String, props: Map<String, Any?>? = null) = emit("payment_$phase", props)

    /** Named flows: checkout | registration | loan | kyc | onboarding | custom. */
    fun flow(phase: String, flow: String, props: Map<String, Any?>? = null) {
        val merged = LinkedHashMap<String, Any?>()
        if (props != null) merged.putAll(props)
        merged["flow"] = flow
        emit("flow_$phase", merged)
    }

    fun permissionDenied(permission: String) = emit("permission_denied", mapOf("permission" to permission))

    fun error(message: String) = emit("error", mapOf("message" to message))

    /** Custom events — also evaluates action `event` triggers + goals. */
    fun track(name: String, props: Map<String, Any?>? = null) {
        val merged = LinkedHashMap<String, Any?>()
        if (props != null) merged.putAll(props)
        merged["name"] = name
        emit("track", merged)
        engine.onTrack(name)
    }

    /** Identify the signed-in user (bridges anonymous → known). */
    fun identify(userId: String) {
        identity.setUserId(userId)
        emit("identify")
    }

    /** Channel launchers (FAQ / Agent chat / WhatsApp) — usable directly. */
    fun openFaq() = cta.openFaq()
    fun openChat() = cta.openChat()
    fun openWhatsApp() = cta.openWhatsApp()

    /** Force a network flush (returns when the batch settled). */
    suspend fun flush() = queue.flushAndJoin()

    /** Introspection (tests/bench). */
    fun anonId(): String = identity.getAnonId()
    fun sessionId(): String = identity.currentSession()
    fun path(): String = currentPath
}

/** Adapts [Identity] to the minimal surface the CTA router needs. */
private class IdentityViewImpl(private val id: Identity) : IdentityView {
    override fun getAnonId() = id.getAnonId()
    override fun currentSession() = id.currentSession()
    override fun getUserId() = id.getUserId()
}

/**
 * Construct and initialize a [TrackiClient]: hydrate identity, wire the queue,
 * CTA router, assist handler and action engine, then emit the cold foreground.
 *
 * @param scope the coroutine scope owning async flushes, manifest load and
 *   fire-and-forget writes (defaults to [GlobalScope] for app use; tests inject
 *   a controlled scope).
 */
@OptIn(kotlinx.coroutines.DelicateCoroutinesApi::class)
suspend fun createTracki(
    config: TrackiConfig,
    scope: CoroutineScope = GlobalScope,
): TrackiClient {
    val now: Clock = config.clock ?: { System.currentTimeMillis() }
    val transport = config.transport ?: httpTransport()
    val newId = config.idFactory ?: ::defaultIdFactory
    val localeFn = { config.locale ?: "ar" }

    val identity = Identity(config.storage, now, scope, newId)
    identity.hydrate()

    val pathBox = PathBox()

    val queue = EventQueue(
        key = config.key,
        eventsUrl = "${config.endpoint}/v1/events",
        identity = identity,
        device = config.device,
        transport = transport,
        now = now,
        scope = scope,
    )

    val cta = CtaRouter(
        key = config.key,
        endpoint = config.endpoint,
        locale = localeFn,
        platform = { config.device.platform },
        currentPath = { pathBox.path },
        queue = queue,
        transport = transport,
        renderer = config.renderer,
        openUrl = config.openUrl,
        identity = IdentityViewImpl(identity),
        now = now,
        scope = scope,
    )

    val assist = AssistHandler(
        locale = localeFn,
        currentPath = { pathBox.path },
        queue = queue,
        renderer = config.renderer,
        cta = cta,
        now = now,
    )
    queue.setResponseHandler(assist::onResponse)

    val engine = ActionEngine(
        key = config.key,
        endpoint = config.endpoint,
        locale = localeFn,
        currentPath = { pathBox.path },
        anonId = { identity.getAnonId() },
        queue = queue,
        transport = transport,
        storage = config.storage,
        renderer = config.renderer,
        cta = cta,
        now = now,
        scope = scope,
    )
    val ready = scope.async { engine.start() }

    val client = TrackiClient(now, identity, queue, cta, engine, pathBox, ready)

    // The launch itself: a cold start (drives app_restart_loop detection).
    client.emitColdStart()
    return client
}
