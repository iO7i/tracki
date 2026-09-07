package app.tracki.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.net.URLEncoder

enum class CtaKind(val wire: String) {
    URL("url"), FAQ("faq"), CHAT("chat"), WHATSAPP("whatsapp")
}

/** Effective channel, tolerating pre-implementation shapes (faq boolean / url-only). */
fun ctaKind(cta: CtaContent): CtaKind = when (cta.kind) {
    "faq" -> CtaKind.FAQ
    "chat" -> CtaKind.CHAT
    "whatsapp" -> CtaKind.WHATSAPP
    "url" -> CtaKind.URL
    else -> if (cta.faq == true) CtaKind.FAQ else CtaKind.URL
}

/** Minimal identity surface the router needs. */
interface IdentityView {
    fun getAnonId(): String
    fun currentSession(): String
    fun getUserId(): String?
}

private val HTTP = Regex("^https?://", RegexOption.IGNORE_CASE)
private val HTTPS = Regex("^https://", RegexOption.IGNORE_CASE)

private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

/**
 * Channel router (implementation "right channeling", mobile edition): a CTA opens a
 * URL, the FAQ help center, the grounded Agent chat, or a WhatsApp handoff —
 * all against the existing public APIs. Fail-silent throughout.
 */
class CtaRouter(
    private val key: String,
    private val endpoint: String,
    private val locale: () -> String,
    /** Device platform stamped on handoffs so the inbox can label the surface. */
    private val platform: () -> String,
    private val currentPath: () -> String,
    private val queue: EventQueue,
    private val transport: Transport,
    private val renderer: Renderer?,
    private val openUrl: ((String) -> Unit)?,
    private val identity: IdentityView,
    private val now: Clock,
    private val scope: CoroutineScope,
) {
    @Suppress("UNCHECKED_CAST")
    suspend fun searchFaq(query: String): List<FaqArticle> {
        val data = runCatching {
            transport.get("$endpoint/v1/faq?key=${enc(key)}&q=${enc(query)}")
        }.getOrNull()
        val articles = (data as? Map<String, Any?>)?.get("articles") as? List<*> ?: return emptyList()
        return articles.filterIsInstance<Map<String, Any?>>().map {
            FaqArticle(
                id = it["id"]?.toString() ?: "",
                title = it["title"]?.toString() ?: "",
                body = it["body"]?.toString() ?: "",
            )
        }
    }

    fun openFaq() {
        val r = renderer ?: return
        scope.launch {
            val articles = searchFaq("")
            r.show(FaqIntent(articles = articles, search = ::searchFaq))
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun openChat() {
        val r = renderer ?: return
        var conversationId: String? = null
        r.show(ChatIntent(send = { message ->
            val body = linkedMapOf<String, Any?>(
                "key" to key,
                "anonId" to identity.getAnonId(),
                "sessionId" to identity.currentSession(),
            )
            identity.getUserId()?.let { body["userId"] = it }
            conversationId?.let { body["conversationId"] = it }
            body["message"] = message
            body["path"] = currentPath()
            val data = runCatching { transport.post("$endpoint/v1/chat", body) }.getOrNull()
            val dict = data as? Map<String, Any?>
            if (dict == null) {
                ChatReply(reply = "", escalate = true)
            } else {
                (dict["conversationId"] as? String)?.takeIf { it.isNotEmpty() }?.let { conversationId = it }
                ChatReply(
                    reply = dict["reply"] as? String ?: "",
                    escalate = dict["escalate"] as? Boolean ?: false,
                )
            }
        }))
    }

    /** Mint a implementation handoff and open the wa.me deep link (the ME killer flow). */
    @Suppress("UNCHECKED_CAST")
    fun openWhatsApp() {
        val body = linkedMapOf<String, Any?>(
            "key" to key,
            "anonId" to identity.getAnonId(),
            "sessionId" to identity.currentSession(),
            "path" to currentPath(),
            "locale" to locale(),
            "platform" to platform(),
        )
        scope.launch {
            val data = runCatching { transport.post("$endpoint/v1/handoff", body) }.getOrNull()
            val link = (data as? Map<String, Any?>)?.get("deepLink") as? String
            if (link != null && HTTPS.containsMatchIn(link)) openUrl?.invoke(link)
        }
    }

    /** Route a CTA tap to its channel. Returns the resolved kind (for telemetry). */
    fun activate(cta: CtaContent): CtaKind {
        val kind = ctaKind(cta)
        when (kind) {
            CtaKind.URL -> cta.url?.takeIf { HTTP.containsMatchIn(it) }?.let { openUrl?.invoke(it) }
            CtaKind.FAQ -> openFaq()
            CtaKind.CHAT -> openChat()
            CtaKind.WHATSAPP -> openWhatsApp()
        }
        return kind
    }
}
