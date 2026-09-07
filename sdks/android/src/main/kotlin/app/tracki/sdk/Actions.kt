package app.tracki.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import kotlin.math.abs

// Local mirror of the mobile manifest entry (zero deps, like the snippet's).
internal data class ManifestLocalized(
    val title: String,
    val body: String,
    val cta: CtaContent?,
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(j: Map<String, Any?>?): ManifestLocalized {
            val m = j ?: emptyMap()
            val c = m["cta"] as? Map<String, Any?>
            val cta = c?.let {
                CtaContent(
                    label = it["label"]?.toString() ?: "",
                    kind = it["kind"] as? String,
                    url = it["url"] as? String,
                    faq = it["faq"] as? Boolean,
                )
            }
            return ManifestLocalized(
                title = m["title"]?.toString() ?: "",
                body = m["body"]?.toString() ?: "",
                cta = cta,
            )
        }
    }
}

internal data class ManifestStep(
    val ar: Pair<String, String>,
    val en: Pair<String, String>,
    val anchor: String?,
)

internal data class ManifestAction(
    val id: String,
    val type: String,
    val arContent: ManifestLocalized,
    val enContent: ManifestLocalized,
    val arContentB: ManifestLocalized?,
    val enContentB: ManifestLocalized?,
    val triggerKind: String,
    val triggerSeconds: Int?,
    val triggerEventName: String?,
    val urlContains: String?,
    val frequencyCap: Int?,
    val goalEvent: String?,
    val anchorSelector: String?,
    val steps: List<ManifestStep>?,
) {
    val hasB: Boolean get() = arContentB != null || enContentB != null

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(raw: Any?): ManifestAction? {
            val m = raw as? Map<String, Any?> ?: return null
            val id = m["id"] as? String ?: return null
            val type = m["type"] as? String ?: return null
            val content = m["content"] as? Map<String, Any?> ?: return null
            val trigger = m["trigger"] as? Map<String, Any?> ?: return null
            val contentB = m["contentB"] as? Map<String, Any?>

            val rawSteps = m["steps"] as? List<*>
            val steps = rawSteps?.filterIsInstance<Map<String, Any?>>()?.map { s ->
                val ar = s["ar"] as? Map<String, Any?> ?: emptyMap()
                val en = s["en"] as? Map<String, Any?> ?: emptyMap()
                ManifestStep(
                    ar = (ar["title"]?.toString() ?: "") to (ar["body"]?.toString() ?: ""),
                    en = (en["title"]?.toString() ?: "") to (en["body"]?.toString() ?: ""),
                    anchor = s["anchor"] as? String,
                )
            }

            return ManifestAction(
                id = id,
                type = type,
                arContent = ManifestLocalized.from(content["ar"] as? Map<String, Any?>),
                enContent = ManifestLocalized.from(content["en"] as? Map<String, Any?>),
                arContentB = (contentB?.get("ar") as? Map<String, Any?>)?.let { ManifestLocalized.from(it) },
                enContentB = (contentB?.get("en") as? Map<String, Any?>)?.let { ManifestLocalized.from(it) },
                triggerKind = trigger["kind"]?.toString() ?: "",
                triggerSeconds = (trigger["seconds"] as? Number)?.toInt(),
                triggerEventName = trigger["eventName"] as? String,
                urlContains = m["urlContains"] as? String,
                frequencyCap = (m["frequencyCap"] as? Number)?.toInt(),
                goalEvent = m["goalEvent"] as? String,
                anchorSelector = m["anchorSelector"] as? String,
                steps = steps,
            )
        }
    }
}

const val CAPS_KEY = "tracki_caps"

/**
 * Stable 50/50 split per visitor (mirrors shared pickVariant). Kotlin `Int` is
 * 32-bit and wraps silently, so `h * 31 + code` reproduces the JS `|0` overflow
 * exactly; `abs(h) % 2` preserves parity even at Int.MIN_VALUE.
 */
fun pickVariant(anonId: String, actionId: String, hasB: Boolean): String {
    if (!hasB) return "A"
    var h = 0
    val s = "$anonId:$actionId"
    for (i in s.indices) {
        // charCodeAt = UTF-16 code unit; Kotlin Char.code is the same for BMP.
        h = h * 31 + s[i].code
    }
    return if (abs(h) % 2 == 0) "A" else "B"
}

/**
 * Mobile action engine — the snippet's actions runtime re-imagined for apps:
 * screen_view plays the role of pageview, app_background plays exit_intent,
 * `event` fires on track(); struggle actions stay server-driven (Live Assist).
 * Frequency caps persist across launches in one storage-backed JSON map.
 */
class ActionEngine(
    private val key: String,
    private val endpoint: String,
    private val locale: () -> String,
    private val currentPath: () -> String,
    private val anonId: () -> String,
    private val queue: EventQueue,
    private val transport: Transport,
    private val storage: KeyValueStorage,
    private val renderer: Renderer?,
    private val cta: CtaRouter,
    private val now: Clock,
    private val scope: CoroutineScope,
) {
    private val actions = ArrayList<ManifestAction>()
    private val shownThisScreen = HashSet<String>()
    private val shownThisSession = HashSet<String>()
    private var caps: MutableMap<String, Int> = HashMap()
    private var capsLoaded = false

    private fun emit(type: String, actionId: String, variant: String, channel: String? = null) {
        val props = linkedMapOf<String, Any?>("action_id" to actionId, "variant" to variant)
        if (channel != null) props["channel"] = channel
        queue.enqueue(EventInput(type = type, ts = now(), path = currentPath(), props = props))
    }

    private suspend fun loadCaps() {
        caps = runCatching {
            val raw = storage.get(CAPS_KEY) ?: "{}"
            val obj = JSONObject(raw)
            val map = HashMap<String, Int>()
            for (k in obj.keys()) map[k] = obj.getInt(k)
            map
        }.getOrDefault(HashMap())
        capsLoaded = true
    }

    private fun bumpCap(a: ManifestAction) {
        caps[a.id] = (caps[a.id] ?: 0) + 1
        val json = JSONObject(caps as Map<*, *>).toString()
        scope.launch { runCatching { storage.set(CAPS_KEY, json) } }
    }

    private fun localized(a: ManifestAction, variant: String): LocalizedContent {
        val L = locale()
        if (variant == "B" && a.hasB) {
            val b = if (L == "en") (a.enContentB ?: a.arContentB) else (a.arContentB ?: a.enContentB)
            if (b != null) return LocalizedContent(b.title, b.body, b.cta)
        }
        val pack = if (L == "en") a.enContent else a.arContent
        return LocalizedContent(pack.title, pack.body, pack.cta)
    }

    private fun tourSteps(a: ManifestAction): List<TourStepContent>? {
        if (a.type != "tour" || a.steps.isNullOrEmpty()) return null
        val L = locale()
        return a.steps.map { s ->
            val (title, body) = if (L == "en") s.en else s.ar
            TourStepContent(title = title, body = body, anchor = s.anchor)
        }
    }

    private fun maybeShow(a: ManifestAction) {
        val r = renderer ?: return
        if (shownThisScreen.contains(a.id)) return
        if (a.urlContains != null && !currentPath().contains(a.urlContains)) return
        if (a.frequencyCap != null && (caps[a.id] ?: 0) >= a.frequencyCap) return
        val variant = pickVariant(anonId(), a.id, a.hasB)
        val content = localized(a, variant)
        val intent = ActionIntent(
            actionId = a.id,
            type = a.type,
            variant = variant,
            content = content,
            steps = tourSteps(a),
            anchor = a.anchorSelector,
            activateCta = {
                val c = content.cta
                if (c != null) {
                    val kind = cta.activate(c)
                    emit("action_click", a.id, variant, kind.wire)
                }
            },
            dismiss = { emit("action_dismiss", a.id, variant) },
        )
        try {
            r.show(intent)
        } catch (e: Throwable) {
            // Audit implementation M1 parity: a failed render is NOT an impression.
            return
        }
        shownThisScreen.add(a.id)
        shownThisSession.add(a.id)
        bumpCap(a)
        emit("action_impression", a.id, variant)
    }

    private fun evaluateScreen() {
        for (a in actions) if (a.triggerKind == "pageview") maybeShow(a)
    }

    /** Fetch the mobile-surface manifest, then arm time-based triggers. */
    @Suppress("UNCHECKED_CAST")
    suspend fun start() {
        loadCaps()
        val k = URLEncoder.encode(key, "UTF-8")
        val data = runCatching {
            transport.get("$endpoint/v1/actions?key=$k&surface=mobile")
        }.getOrNull()
        val list = (data as? Map<String, Any?>)?.get("actions") as? List<*>
        list?.forEach { raw -> ManifestAction.from(raw)?.let { actions.add(it) } }
        evaluateScreen()
        for (a in actions) {
            if (a.triggerKind == "time_on_page") {
                val secs = (a.triggerSeconds ?: 5).toLong()
                scope.launch {
                    delay(secs * 1000)
                    maybeShow(a)
                }
            }
        }
    }

    /** New screen — screen-scoped impressions reset, pageview triggers re-run. */
    fun onScreen() {
        shownThisScreen.clear()
        if (capsLoaded) evaluateScreen()
    }

    /** App went to background — the mobile analogue of exit intent. */
    fun onBackground() {
        for (a in actions) if (a.triggerKind == "exit_intent") maybeShow(a)
    }

    /** A custom event — event triggers + goal attribution. */
    fun onTrack(name: String) {
        for (a in actions) {
            if (a.triggerKind == "event" && a.triggerEventName == name) maybeShow(a)
            if (a.goalEvent == name && shownThisSession.contains(a.id)) {
                emit("action_goal", a.id, pickVariant(anonId(), a.id, a.hasB))
            }
        }
    }

    /** Test seam. */
    val loadedCount: Int get() = actions.size
}
