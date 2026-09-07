package app.tracki.sdk

internal data class AssistContentWire(
    val title: String,
    val body: String,
    val cta: CtaContent?,
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(j: Map<String, Any?>?): AssistContentWire {
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
            return AssistContentWire(
                title = m["title"]?.toString() ?: "",
                body = m["body"]?.toString() ?: "",
                cta = cta,
            )
        }
    }
}

internal data class AssistPayload(
    val actionId: String,
    val mode: String,
    val arContent: AssistContentWire,
    val enContent: AssistContentWire,
    val arArticle: Pair<String, String>?,
    val enArticle: Pair<String, String>?,
    val articleId: String?,
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(raw: Any?): AssistPayload? {
            val m = raw as? Map<String, Any?> ?: return null
            val actionId = m["actionId"] as? String ?: return null
            val content = m["content"] as? Map<String, Any?> ?: return null

            fun article(a: Any?): Pair<String, String>? {
                val d = a as? Map<String, Any?> ?: return null
                return (d["title"]?.toString() ?: "") to (d["body"]?.toString() ?: "")
            }
            val art = m["article"] as? Map<String, Any?>

            return AssistPayload(
                actionId = actionId,
                mode = m["mode"] as? String ?: "fallback",
                arContent = AssistContentWire.from(content["ar"] as? Map<String, Any?>),
                enContent = AssistContentWire.from(content["en"] as? Map<String, Any?>),
                arArticle = article(art?.get("ar")),
                enArticle = article(art?.get("en")),
                articleId = m["articleId"] as? String,
            )
        }
    }
}

/**
 * Server-driven Live Assist, mobile edition (slice 5 mechanism unchanged):
 * the worker matched a struggle to an action + FAQ and stashed the payload;
 * it arrives on an event-flush response and renders as a contextual drawer.
 * Once per session per action; fail-silent.
 */
class AssistHandler(
    private val locale: () -> String,
    private val currentPath: () -> String,
    private val queue: EventQueue,
    private val renderer: Renderer?,
    private val cta: CtaRouter,
    private val now: Clock,
) {
    private val shown = HashSet<String>()

    private fun emit(type: String, p: AssistPayload) {
        val props = linkedMapOf<String, Any?>("action_id" to p.actionId, "mode" to p.mode)
        if (p.articleId != null) props["article_id"] = p.articleId
        queue.enqueue(EventInput(type = type, ts = now(), path = currentPath(), props = props))
    }

    internal fun show(payload: AssistPayload) {
        val r = renderer ?: return
        if (shown.contains(payload.actionId)) return
        val L = locale()
        val authored = if (L == "en") payload.enContent else payload.arContent
        var title = authored.title
        var body = authored.body
        if (payload.mode == "answer" && (payload.arArticle != null || payload.enArticle != null)) {
            val candidate = if (L == "en") payload.enArticle else payload.arArticle
            val a = if (candidate != null && candidate.first.isNotEmpty()) candidate
            else (payload.arArticle ?: payload.enArticle)
            if (a != null) {
                title = a.first
                body = a.second
            }
        }
        if (title.isEmpty() && body.isEmpty()) return
        shown.add(payload.actionId)

        val ctaContent = authored.cta
        val intent = AssistIntent(
            actionId = payload.actionId,
            mode = payload.mode,
            title = title,
            body = body,
            ctaLabel = ctaContent?.label,
            helpful = { emit("assist_helpful", payload) },
            unhelpful = {
                emit("assist_unhelpful", payload)
                // Parity with the snippet: an unhelpful answer offers the Agent.
                cta.openChat()
            },
            escalate = {
                emit("assist_escalate", payload)
                if (ctaContent != null) {
                    val kind = ctaKind(ctaContent)
                    when {
                        kind == CtaKind.URL -> cta.activate(ctaContent)
                        kind == CtaKind.FAQ && ctaContent.kind == "faq" -> cta.openFaq()
                        kind == CtaKind.WHATSAPP -> cta.openWhatsApp()
                        else -> // chat — and the legacy slice-5 shape (faq:true,
                            // no kind), which keeps its audited semantics of
                            // escalating to the Agent.
                            cta.openChat()
                    }
                }
            },
        )
        try {
            r.show(intent)
            emit("assist_shown", payload)
        } catch (e: Throwable) {
            // fail-silent
        }
    }

    /** Wire as the queue's response handler. */
    @Suppress("UNCHECKED_CAST")
    fun onResponse(data: Any?) {
        val raw = (data as? Map<String, Any?>)?.get("assist") ?: return
        AssistPayload.from(raw)?.let { show(it) }
    }
}
