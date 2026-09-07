//
//  Cta.swift
//  Channel router (slice 12 "right channeling", mobile edition): a CTA opens a
//  URL, the FAQ help center, the grounded Agent chat, or a WhatsApp handoff —
//  all against the existing public APIs. Fail-silent throughout.
//

import Foundation

public enum CtaKind: String {
    case url, faq, chat, whatsapp
}

/// Effective channel, tolerating pre-slice-12 shapes (faq boolean / url-only).
public func ctaKind(_ cta: CtaContent) -> CtaKind {
    switch cta.kind {
    case "faq": return .faq
    case "chat": return .chat
    case "whatsapp": return .whatsapp
    case "url": return .url
    default: return (cta.faq == true) ? .faq : .url
    }
}

/// Minimal identity surface the router needs.
public protocol IdentityView: AnyObject {
    func getAnonId() -> String
    func currentSession() -> String
    func getUserId() -> String?
}

extension Identity: IdentityView {}

private func matchesHTTP(_ s: String) -> Bool {
    s.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil
}

private func matchesHTTPS(_ s: String) -> Bool {
    s.range(of: "^https://", options: [.regularExpression, .caseInsensitive]) != nil
}

public final class CtaRouter: @unchecked Sendable {
    let key: String
    let endpoint: String
    let locale: () -> String
    /// Device platform stamped on handoffs so the inbox can label the surface.
    let platform: () -> String
    let currentPath: () -> String
    let queue: EventQueue
    let transport: Transport
    weak var renderer: Renderer?
    let openUrl: ((String) -> Void)?
    let identity: IdentityView
    let now: Clock

    public init(
        key: String,
        endpoint: String,
        locale: @escaping () -> String,
        platform: @escaping () -> String,
        currentPath: @escaping () -> String,
        queue: EventQueue,
        transport: Transport,
        renderer: Renderer?,
        openUrl: ((String) -> Void)?,
        identity: IdentityView,
        now: @escaping Clock
    ) {
        self.key = key
        self.endpoint = endpoint
        self.locale = locale
        self.platform = platform
        self.currentPath = currentPath
        self.queue = queue
        self.transport = transport
        self.renderer = renderer
        self.openUrl = openUrl
        self.identity = identity
        self.now = now
    }

    public func searchFaq(_ query: String) async -> [FaqArticle] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? ""
        let k = key.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? key
        let data = await transport.get("\(endpoint)/v1/faq?key=\(k)&q=\(q)")
        guard let dict = data as? [String: Any],
              let arr = dict["articles"] as? [[String: Any]] else { return [] }
        return arr.map {
            FaqArticle(
                id: "\($0["id"] ?? "")",
                title: "\($0["title"] ?? "")",
                body: "\($0["body"] ?? "")"
            )
        }
    }

    public func openFaq() {
        guard let renderer else { return }
        Task {
            let articles = await searchFaq("")
            renderer.show(.faq(FaqIntent(articles: articles, search: { [weak self] q in
                await self?.searchFaq(q) ?? []
            })))
        }
    }

    public func openChat() {
        guard let renderer else { return }
        // conversationId is captured across turns by the closure's box.
        let conversationBox = ConversationBox()
        let send: (String) async -> ChatReply = { [weak self] message in
            guard let self else { return ChatReply(reply: "", escalate: true) }
            var body: [String: Any] = [
                "key": self.key,
                "anonId": self.identity.getAnonId(),
                "sessionId": self.identity.currentSession(),
            ]
            if let uid = self.identity.getUserId() { body["userId"] = uid }
            if let cid = conversationBox.id { body["conversationId"] = cid }
            body["message"] = message
            body["path"] = self.currentPath()
            let data = await self.transport.post("\(self.endpoint)/v1/chat", body)
            guard let dict = data as? [String: Any] else {
                return ChatReply(reply: "", escalate: true)
            }
            if let cid = dict["conversationId"] as? String, !cid.isEmpty {
                conversationBox.id = cid
            }
            let reply = dict["reply"] as? String ?? ""
            let escalate = dict["escalate"] as? Bool ?? false
            return ChatReply(reply: reply, escalate: escalate)
        }
        renderer.show(.chat(ChatIntent(send: send)))
    }

    /// Mint a slice-7 handoff and open the wa.me deep link (the ME killer flow).
    public func openWhatsApp() {
        let body: [String: Any] = [
            "key": key,
            "anonId": identity.getAnonId(),
            "sessionId": identity.currentSession(),
            "path": currentPath(),
            "locale": locale(),
            "platform": platform(),
        ]
        Task { [weak self] in
            guard let self else { return }
            let data = await self.transport.post("\(self.endpoint)/v1/handoff", body)
            if let dict = data as? [String: Any],
               let link = dict["deepLink"] as? String, matchesHTTPS(link) {
                self.openUrl?(link)
            }
        }
    }

    /// Route a CTA tap to its channel. Returns the resolved kind (for telemetry).
    @discardableResult
    public func activate(_ cta: CtaContent) -> CtaKind {
        let kind = ctaKind(cta)
        switch kind {
        case .url:
            if let u = cta.url, matchesHTTP(u) { openUrl?(u) }
        case .faq:
            openFaq()
        case .chat:
            openChat()
        case .whatsapp:
            openWhatsApp()
        }
        return kind
    }
}

/// Reference box that keeps the chat conversation id across turns.
final class ConversationBox: @unchecked Sendable {
    var id: String?
}

extension CharacterSet {
    /// RFC-3986 query-value safe set (mirrors encodeURIComponent closely enough
    /// for the keys/queries used here).
    static let urlQueryValueAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()
}
