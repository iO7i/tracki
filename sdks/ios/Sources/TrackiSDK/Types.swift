//
//  Types.swift
//  TrackiSDK — the Swift port of `@tracki/mobile-core`, the headless protocol
//  engine every Tracki mobile SDK wraps (React Native directly; Flutter/iOS/
//  Android re-implement the same wire protocol — see
//  docs/mobile-wire-protocol.md). Zero UI, zero platform assumptions in the
//  core: storage / transport / clock are injected, rendering is delegated to a
//  platform renderer through typed intents.
//
//  Wire bodies are `[String: Any]` dictionaries serialized with
//  JSONSerialization so that omitted/undefined fields are ABSENT from the JSON
//  (never `null`) — exactly matching the TS reference's JSON.stringify(undefined)
//  drop semantics.
//

import Foundation

// MARK: - Wire mirrors

/// "ios" | "android" — REQUIRED for mobile batches.
public typealias MobilePlatform = String

/// Device block of the batch envelope. Omitted fields are absent from the JSON.
public struct DeviceInfo: Equatable, Sendable {
    public var platform: String
    public var osVersion: String?
    public var appVersion: String?
    public var model: String?
    /// "react-native" | "flutter" | "ios" | "android".
    public var sdk: String?

    public init(
        platform: String,
        osVersion: String? = nil,
        appVersion: String? = nil,
        model: String? = nil,
        sdk: String? = nil
    ) {
        self.platform = platform
        self.osVersion = osVersion
        self.appVersion = appVersion
        self.model = model
        self.sdk = sdk
    }

    /// JSON object with omitted optionals absent (never NSNull).
    public func toJSON() -> [String: Any] {
        var m: [String: Any] = ["platform": platform]
        if let osVersion { m["osVersion"] = osVersion }
        if let appVersion { m["appVersion"] = appVersion }
        if let model { m["model"] = model }
        if let sdk { m["sdk"] = sdk }
        return m
    }

    public static func from(json: [String: Any]) -> DeviceInfo {
        DeviceInfo(
            platform: json["platform"] as? String ?? "",
            osVersion: json["osVersion"] as? String,
            appVersion: json["appVersion"] as? String,
            model: json["model"] as? String,
            sdk: json["sdk"] as? String
        )
    }
}

/// A single queued event. `path`/`referrer`/`url`/`props` are omitted from the
/// serialized JSON when nil (the wire protocol forbids explicit nulls).
public struct EventInput {
    public var type: String
    public var ts: Int
    public var path: String?
    public var url: String?
    public var referrer: String?
    public var props: [String: Any]?

    public init(
        type: String,
        ts: Int,
        path: String? = nil,
        url: String? = nil,
        referrer: String? = nil,
        props: [String: Any]? = nil
    ) {
        self.type = type
        self.ts = ts
        self.path = path
        self.url = url
        self.referrer = referrer
        self.props = props
    }

    public func toJSON() -> [String: Any] {
        var m: [String: Any] = ["type": type, "ts": ts]
        if let path { m["path"] = path }
        if let url { m["url"] = url }
        if let referrer { m["referrer"] = referrer }
        if let props { m["props"] = props }
        return m
    }
}

/// The `/v1/events` batch envelope. `userId` is omitted when anonymous.
public struct Batch {
    public var key: String
    public var anonId: String
    public var userId: String?
    public var sessionId: String
    public var sentAt: Int
    public var device: DeviceInfo
    public var events: [EventInput]

    public func toJSON() -> [String: Any] {
        var m: [String: Any] = ["key": key, "anonId": anonId]
        if let userId { m["userId"] = userId }
        m["sessionId"] = sessionId
        m["sentAt"] = sentAt
        m["device"] = device.toJSON()
        m["events"] = events.map { $0.toJSON() }
        return m
    }
}

// MARK: - Injected platform adapters

/// Async key-value persistence (UserDefaults by default; any backing store).
public protocol KeyValueStorage: Sendable {
    func get(_ key: String) async -> String?
    func set(_ key: String, _ value: String) async
}

/// HTTP transport; the default implementation uses URLSession. Both methods
/// return the decoded JSON body (a dictionary/array) or nil.
public protocol Transport: Sendable {
    func post(_ url: String, _ body: [String: Any]) async -> Any?
    func get(_ url: String) async -> Any?
}

/// Injectable clock for deterministic tests — returns ms epoch.
public typealias Clock = @Sendable () -> Int

/// Id factory keyed by prefix ("anon" / "sess"). Test seam.
public typealias IdFactory = @Sendable (String) -> String

// MARK: - Render intents (SDK → app UI)

/// A channel CTA. `kind` ∈ url|faq|chat|whatsapp; legacy `faq:true` ⇒ faq.
public struct CtaContent {
    public var label: String
    public var kind: String?
    public var url: String?
    public var faq: Bool?

    public init(label: String, kind: String? = nil, url: String? = nil, faq: Bool? = nil) {
        self.label = label
        self.kind = kind
        self.url = url
        self.faq = faq
    }
}

/// Locale-resolved content for an action surface.
public struct LocalizedContent {
    public var title: String
    public var body: String
    public var cta: CtaContent?

    public init(title: String, body: String, cta: CtaContent? = nil) {
        self.title = title
        self.body = body
        self.cta = cta
    }
}

/// One guided-tour step, locale-resolved.
public struct TourStepContent {
    public var title: String
    public var body: String
    public var anchor: String?
}

/// A single FAQ/help-center article.
public struct FaqArticle {
    public var id: String
    public var title: String
    public var body: String
}

/// Result of a single chat turn.
public struct ChatReply {
    public var reply: String
    public var escalate: Bool
}

/// A campaign action ready to render (popup/banner/tooltip/tour/drawer).
public struct ActionIntent {
    public let intent = "action"
    public var actionId: String
    /// popup ⇒ in-app modal; banner; tooltip; tour (steps); drawer (help sheet).
    public var type: String
    public var variant: String // "A" | "B"
    /// Content resolved for the configured locale.
    public var content: LocalizedContent
    /// Guided-tour steps (type "tour"), locale-resolved.
    public var steps: [TourStepContent]?
    /// Anchor key for tooltips (the app maps it to a view).
    public var anchor: String?
    /// Report a tap on the CTA; routes the channel (url/faq/chat/whatsapp).
    public var activateCta: () -> Void
    /// Report the user dismissing the action.
    public var dismiss: () -> Void
}

/// Server-driven Live Assist for a detected struggle (implementation mechanism).
public struct AssistIntent {
    public let intent = "assist"
    public var actionId: String
    public var mode: String // "answer" | "fallback"
    /// Resolved title/body — the matched FAQ in answer mode, else authored copy.
    public var title: String
    public var body: String
    /// Escalation CTA label from the action's authored content, if any.
    public var ctaLabel: String?
    /// Answer mode: report "was this helpful?".
    public var helpful: () -> Void
    public var unhelpful: () -> Void
    /// Tap the escalate CTA (routes the channel).
    public var escalate: () -> Void
}

/// FAQ launch (cta kind "faq"): pre-fetched published articles.
public struct FaqIntent {
    public let intent = "faq"
    public var articles: [FaqArticle]
    /// Re-query the help center.
    public var search: (String) async -> [FaqArticle]
}

/// AI chat launch (cta kind "chat"): a live grounded-Agent conversation.
public struct ChatIntent {
    public let intent = "chat"
    public var send: (String) async -> ChatReply
}

/// Everything handed to the platform `Renderer`.
public enum RenderIntent {
    case action(ActionIntent)
    case assist(AssistIntent)
    case faq(FaqIntent)
    case chat(ChatIntent)
}

/// The platform SDK's renderer — receives intents, draws native UI.
public protocol Renderer: AnyObject {
    func show(_ intent: RenderIntent)
}

// MARK: - Config

/// Construction config for `Tracki(config:)`.
public struct TrackiConfig {
    /// Project public key (pk_…).
    public var key: String
    /// Ingest origin, e.g. https://ingest.tracki.app
    public var endpoint: String
    public var device: DeviceInfo
    public var storage: KeyValueStorage
    /// UI locale for resolved content; Arabic-first default ("ar").
    public var locale: String? // "ar" | "en"
    public var renderer: Renderer?
    /// Open an external URL (wa.me deep link, cta url). Required for those CTAs.
    public var openUrl: ((String) -> Void)?
    public var transport: Transport?
    public var clock: Clock?
    /// Test seam: ids default to a UUID-based factory.
    public var idFactory: IdFactory?

    public init(
        key: String,
        endpoint: String,
        device: DeviceInfo,
        storage: KeyValueStorage,
        locale: String? = nil,
        renderer: Renderer? = nil,
        openUrl: ((String) -> Void)? = nil,
        transport: Transport? = nil,
        clock: Clock? = nil,
        idFactory: IdFactory? = nil
    ) {
        self.key = key
        self.endpoint = endpoint
        self.device = device
        self.storage = storage
        self.locale = locale
        self.renderer = renderer
        self.openUrl = openUrl
        self.transport = transport
        self.clock = clock
        self.idFactory = idFactory
    }
}
