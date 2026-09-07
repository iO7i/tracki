/*
 * tracki-android — the Kotlin port of `@tracki/mobile-core`, the headless
 * protocol engine every Tracki mobile SDK wraps (React Native directly;
 * Flutter/iOS/Android re-implement the same wire protocol — see
 * docs/mobile-wire-protocol.md). Zero UI, zero platform assumptions in the core:
 * storage / transport / clock are injected, rendering is delegated to a platform
 * renderer through typed intents.
 *
 * The core module is pure Kotlin/JVM so the conformance suite runs under plain
 * JUnit. Wire bodies are built as Map<String, Any?> with omitted optionals
 * ABSENT (never null) — matching the TS reference's JSON.stringify drop rules.
 */
package app.tracki.sdk

// ── Wire mirrors ─────────────────────────────────────────────────────────────

/** "ios" | "android" — REQUIRED for mobile batches. */
typealias MobilePlatform = String

/** Device block of the batch envelope. Omitted fields are absent from JSON. */
data class DeviceInfo(
    val platform: String,
    val osVersion: String? = null,
    val appVersion: String? = null,
    val model: String? = null,
    /** "react-native" | "flutter" | "ios" | "android". */
    val sdk: String? = null,
) {
    /** JSON map with omitted optionals absent (never null). */
    fun toJson(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("platform" to platform)
        if (osVersion != null) m["osVersion"] = osVersion
        if (appVersion != null) m["appVersion"] = appVersion
        if (model != null) m["model"] = model
        if (sdk != null) m["sdk"] = sdk
        return m
    }

    companion object {
        fun fromJson(j: Map<String, Any?>): DeviceInfo = DeviceInfo(
            platform = j["platform"] as? String ?: "",
            osVersion = j["osVersion"] as? String,
            appVersion = j["appVersion"] as? String,
            model = j["model"] as? String,
            sdk = j["sdk"] as? String,
        )
    }
}

/**
 * A single queued event. `path`/`referrer`/`url`/`props` are omitted from the
 * serialized JSON when null (the wire protocol forbids explicit nulls).
 */
data class EventInput(
    val type: String,
    val ts: Long,
    val path: String? = null,
    val url: String? = null,
    val referrer: String? = null,
    val props: Map<String, Any?>? = null,
) {
    fun toJson(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("type" to type, "ts" to ts)
        if (path != null) m["path"] = path
        if (url != null) m["url"] = url
        if (referrer != null) m["referrer"] = referrer
        if (props != null) m["props"] = props
        return m
    }
}

/** The `/v1/events` batch envelope. `userId` is omitted when anonymous. */
data class Batch(
    val key: String,
    val anonId: String,
    val userId: String?,
    val sessionId: String,
    val sentAt: Long,
    val device: DeviceInfo,
    val events: List<EventInput>,
) {
    fun toJson(): Map<String, Any?> {
        val m = linkedMapOf<String, Any?>("key" to key, "anonId" to anonId)
        if (userId != null) m["userId"] = userId
        m["sessionId"] = sessionId
        m["sentAt"] = sentAt
        m["device"] = device.toJson()
        m["events"] = events.map { it.toJson() }
        return m
    }
}

// ── Injected platform adapters ───────────────────────────────────────────────

/** Async key-value persistence (SharedPreferences by default; any store). */
interface KeyValueStorage {
    suspend fun get(key: String): String?
    suspend fun set(key: String, value: String)
}

/**
 * HTTP transport; the default implementation uses HttpURLConnection. Both
 * methods return the decoded JSON body (a Map/List) or null.
 */
interface Transport {
    suspend fun post(url: String, body: Map<String, Any?>): Any?
    suspend fun get(url: String): Any?
}

/** Injectable clock for deterministic tests — returns ms epoch. */
typealias Clock = () -> Long

/** Id factory keyed by prefix ("anon" / "sess"). Test seam. */
typealias IdFactory = (String) -> String

// ── Render intents (SDK → app UI) ────────────────────────────────────────────

/** A channel CTA. `kind` ∈ url|faq|chat|whatsapp; legacy `faq:true` ⇒ faq. */
data class CtaContent(
    val label: String,
    val kind: String? = null,
    val url: String? = null,
    val faq: Boolean? = null,
)

/** Locale-resolved content for an action surface. */
data class LocalizedContent(
    val title: String,
    val body: String,
    val cta: CtaContent? = null,
)

/** One guided-tour step, locale-resolved. */
data class TourStepContent(
    val title: String,
    val body: String,
    val anchor: String? = null,
)

/** A single FAQ/help-center article. */
data class FaqArticle(
    val id: String,
    val title: String,
    val body: String,
)

/** Result of a single chat turn. */
data class ChatReply(
    val reply: String,
    val escalate: Boolean,
)

/** Everything handed to the platform [Renderer]. */
sealed interface RenderIntent

/** A campaign action ready to render (popup/banner/tooltip/tour/drawer). */
data class ActionIntent(
    val actionId: String,
    /** popup ⇒ in-app modal; banner; tooltip; tour (steps); drawer (help sheet). */
    val type: String,
    val variant: String, // "A" | "B"
    /** Content resolved for the configured locale. */
    val content: LocalizedContent,
    /** Guided-tour steps (type "tour"), locale-resolved. */
    val steps: List<TourStepContent>? = null,
    /** Anchor key for tooltips (the app maps it to a view). */
    val anchor: String? = null,
    /** Report a tap on the CTA; routes the channel (url/faq/chat/whatsapp). */
    val activateCta: () -> Unit,
    /** Report the user dismissing the action. */
    val dismiss: () -> Unit,
) : RenderIntent

/** Server-driven Live Assist for a detected struggle (slice 5 mechanism). */
data class AssistIntent(
    val actionId: String,
    val mode: String, // "answer" | "fallback"
    /** Resolved title/body — the matched FAQ in answer mode, else authored copy. */
    val title: String,
    val body: String,
    /** Escalation CTA label from the action's authored content, if any. */
    val ctaLabel: String? = null,
    /** Answer mode: report "was this helpful?". */
    val helpful: () -> Unit,
    val unhelpful: () -> Unit,
    /** Tap the escalate CTA (routes the channel). */
    val escalate: () -> Unit,
) : RenderIntent

/** FAQ launch (cta kind "faq"): pre-fetched published articles. */
data class FaqIntent(
    val articles: List<FaqArticle>,
    /** Re-query the help center. */
    val search: suspend (String) -> List<FaqArticle>,
) : RenderIntent

/** AI chat launch (cta kind "chat"): a live grounded-Agent conversation. */
data class ChatIntent(
    val send: suspend (String) -> ChatReply,
) : RenderIntent

/** The platform SDK's renderer — receives intents, draws native UI. */
fun interface Renderer {
    fun show(intent: RenderIntent)
}

// ── Config ───────────────────────────────────────────────────────────────────

/** Construction config for [createTracki]. */
data class TrackiConfig(
    /** Project public key (pk_…). */
    val key: String,
    /** Ingest origin, e.g. https://ingest.tracki.app */
    val endpoint: String,
    val device: DeviceInfo,
    val storage: KeyValueStorage,
    /** UI locale for resolved content; Arabic-first default ("ar"). */
    val locale: String? = null, // "ar" | "en"
    val renderer: Renderer? = null,
    /** Open an external URL (wa.me deep link, cta url). Required for those CTAs. */
    val openUrl: ((String) -> Unit)? = null,
    val transport: Transport? = null,
    val clock: Clock? = null,
    /** Test seam: ids default to a UUID-based factory. */
    val idFactory: IdFactory? = null,
)
