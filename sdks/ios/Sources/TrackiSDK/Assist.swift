//
//  Assist.swift
//  Server-driven Live Assist, mobile edition (slice 5 mechanism unchanged):
//  the worker matched a struggle to an action + FAQ and stashed the payload;
//  it arrives on an event-flush response and renders as a contextual drawer.
//  Once per session per action; fail-silent.
//

import Foundation

struct AssistContentWire {
    var title: String
    var body: String
    var cta: CtaContent?

    static func from(_ j: [String: Any]) -> AssistContentWire {
        var cta: CtaContent?
        if let c = j["cta"] as? [String: Any] {
            cta = CtaContent(
                label: "\(c["label"] ?? "")",
                kind: c["kind"] as? String,
                url: c["url"] as? String,
                faq: c["faq"] as? Bool
            )
        }
        return AssistContentWire(
            title: "\(j["title"] ?? "")",
            body: "\(j["body"] ?? "")",
            cta: cta
        )
    }
}

struct AssistPayload {
    var actionId: String
    var mode: String // "answer" | "fallback"
    var arContent: AssistContentWire
    var enContent: AssistContentWire
    var arArticle: (title: String, body: String)?
    var enArticle: (title: String, body: String)?
    var articleId: String?

    static func from(_ raw: Any) -> AssistPayload? {
        guard let m = raw as? [String: Any],
              let actionId = m["actionId"] as? String,
              let content = m["content"] as? [String: Any] else { return nil }

        func article(_ a: Any?) -> (title: String, body: String)? {
            guard let d = a as? [String: Any] else { return nil }
            return ("\(d["title"] ?? "")", "\(d["body"] ?? "")")
        }
        let art = m["article"] as? [String: Any]

        return AssistPayload(
            actionId: actionId,
            mode: m["mode"] as? String ?? "fallback",
            arContent: AssistContentWire.from(content["ar"] as? [String: Any] ?? [:]),
            enContent: AssistContentWire.from(content["en"] as? [String: Any] ?? [:]),
            arArticle: article(art?["ar"]),
            enArticle: article(art?["en"]),
            articleId: m["articleId"] as? String
        )
    }
}

public final class AssistHandler: @unchecked Sendable {
    let locale: () -> String
    let currentPath: () -> String
    let queue: EventQueue
    weak var renderer: Renderer?
    let cta: CtaRouter
    let now: Clock

    private var shown = Set<String>()

    public init(
        locale: @escaping () -> String,
        currentPath: @escaping () -> String,
        queue: EventQueue,
        renderer: Renderer?,
        cta: CtaRouter,
        now: @escaping Clock
    ) {
        self.locale = locale
        self.currentPath = currentPath
        self.queue = queue
        self.renderer = renderer
        self.cta = cta
        self.now = now
    }

    private func emit(_ type: String, _ p: AssistPayload) {
        var props: [String: Any] = ["action_id": p.actionId, "mode": p.mode]
        if let articleId = p.articleId { props["article_id"] = articleId }
        queue.enqueue(EventInput(type: type, ts: now(), path: currentPath(), props: props))
    }

    func show(_ payload: AssistPayload) {
        guard let renderer, !shown.contains(payload.actionId) else { return }
        let L = locale()
        let authored = (L == "en") ? payload.enContent : payload.arContent
        var title = authored.title
        var body = authored.body
        if payload.mode == "answer", payload.arArticle != nil || payload.enArticle != nil {
            let candidate = (L == "en") ? payload.enArticle : payload.arArticle
            let a = (candidate?.title.isEmpty == false) ? candidate : (payload.arArticle ?? payload.enArticle)
            if let a {
                title = a.title
                body = a.body
            }
        }
        if title.isEmpty, body.isEmpty { return }
        shown.insert(payload.actionId)

        let ctaContent = authored.cta
        let intent = AssistIntent(
            actionId: payload.actionId,
            mode: payload.mode,
            title: title,
            body: body,
            ctaLabel: ctaContent?.label,
            helpful: { [weak self] in self?.emit("assist_helpful", payload) },
            unhelpful: { [weak self] in
                guard let self else { return }
                self.emit("assist_unhelpful", payload)
                // Parity with the snippet: an unhelpful answer offers the Agent.
                self.cta.openChat()
            },
            escalate: { [weak self] in
                guard let self else { return }
                self.emit("assist_escalate", payload)
                guard let cta = ctaContent else { return }
                let kind = ctaKind(cta)
                if kind == .url {
                    self.cta.activate(cta)
                } else if kind == .faq, cta.kind == "faq" {
                    self.cta.openFaq()
                } else if kind == .whatsapp {
                    self.cta.openWhatsApp()
                } else {
                    // chat — and the legacy slice-5 shape (faq:true, no kind),
                    // which keeps its audited semantics of escalating to the Agent.
                    self.cta.openChat()
                }
            }
        )
        if let throwing = renderer as? ThrowingRenderer {
            do {
                try throwing.tryShow(.assist(intent))
                emit("assist_shown", payload)
            } catch {
                // fail-silent
            }
        } else {
            renderer.show(.assist(intent))
            emit("assist_shown", payload)
        }
    }

    /// Wire as the queue's response handler.
    public func onResponse(_ data: Any?) {
        guard let dict = data as? [String: Any], let raw = dict["assist"] else { return }
        if let assist = AssistPayload.from(raw) { show(assist) }
    }
}
