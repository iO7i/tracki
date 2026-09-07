//
//  Client.swift
//  The Tracki mobile client. Hydrates identity from storage, then exposes a
//  fully synchronous tracking API (flushes are async + fail-silent). Emits the
//  cold app_foreground itself — one fewer thing for the host app to remember,
//  and the signal app_restart_loop detection needs.
//

import Foundation

/// "Checkout Screen" → "/Checkout-Screen"-style path key (case preserved).
public func screenPath(_ name: String) -> String {
    let cleaned = name.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
    return cleaned.hasPrefix("/") ? cleaned : "/\(cleaned)"
}

/// UserDefaults-backed `KeyValueStorage` (the default persistence on Apple OSes).
public struct UserDefaultsStorage: KeyValueStorage {
    private let defaults: UserDefaults
    public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

    public func get(_ key: String) async -> String? { defaults.string(forKey: key) }
    public func set(_ key: String, _ value: String) async { defaults.set(value, forKey: key) }
}

public final class Tracki: @unchecked Sendable {
    private let now: Clock
    private let identity: Identity
    private let queue: EventQueue
    private let cta: CtaRouter
    private let engine: ActionEngine

    private var currentPath = "/"
    private var previousPath = ""
    private var screenEnteredAt: Int

    /// Resolves when the action manifest finished loading (tests/bench).
    public let ready: Task<Void, Never>

    private init(
        now: @escaping Clock,
        identity: Identity,
        queue: EventQueue,
        cta: CtaRouter,
        engine: ActionEngine,
        ready: Task<Void, Never>
    ) {
        self.now = now
        self.identity = identity
        self.queue = queue
        self.cta = cta
        self.engine = engine
        self.ready = ready
        self.screenEnteredAt = now()
    }

    /// Construct and initialize the client: hydrate identity, wire the queue,
    /// CTA router, assist handler and action engine, then emit the cold
    /// foreground. `await client.ready` to wait for the manifest load.
    public static func create(_ config: TrackiConfig) async -> Tracki {
        let now: Clock = config.clock ?? { Int(Date().timeIntervalSince1970 * 1000) }
        let transport = config.transport ?? URLSessionTransport()
        let newId = config.idFactory ?? defaultIdFactory
        let localeFn: () -> String = { config.locale ?? "ar" }

        let identity = Identity(storage: config.storage, now: now, newId: newId)
        await identity.hydrate()

        let queue = EventQueue(
            key: config.key,
            eventsUrl: "\(config.endpoint)/v1/events",
            identity: identity,
            device: config.device,
            transport: transport,
            now: now
        )

        // currentPath is read lazily via a holder captured by the closures below.
        let pathBox = PathBox()

        let cta = CtaRouter(
            key: config.key,
            endpoint: config.endpoint,
            locale: localeFn,
            platform: { config.device.platform },
            currentPath: { pathBox.path },
            queue: queue,
            transport: transport,
            renderer: config.renderer,
            openUrl: config.openUrl,
            identity: identity,
            now: now
        )

        let assist = AssistHandler(
            locale: localeFn,
            currentPath: { pathBox.path },
            queue: queue,
            renderer: config.renderer,
            cta: cta,
            now: now
        )
        queue.setResponseHandler(assist.onResponse)

        let engine = ActionEngine(
            key: config.key,
            endpoint: config.endpoint,
            locale: localeFn,
            currentPath: { pathBox.path },
            anonId: { identity.getAnonId() },
            queue: queue,
            transport: transport,
            storage: config.storage,
            renderer: config.renderer,
            cta: cta,
            now: now
        )
        let ready = Task { await engine.start() }

        let client = Tracki(
            now: now,
            identity: identity,
            queue: queue,
            cta: cta,
            engine: engine,
            ready: ready
        )
        client.pathBox = pathBox

        // The launch itself: a cold start (drives app_restart_loop detection).
        client.emit("app_foreground", ["launch": "cold"])
        return client
    }

    private var pathBox = PathBox()

    private func emit(_ type: String, _ props: [String: Any]? = nil) {
        queue.enqueue(EventInput(
            type: type,
            ts: now(),
            path: currentPath,
            referrer: previousPath.isEmpty ? nil : previousPath,
            props: props
        ))
    }

    // MARK: Screen tracking

    /// Emits screen_leave (with duration) + screen_view.
    public func screen(_ name: String, props: [String: Any]? = nil) {
        let next = screenPath(name)
        if currentPath != "/" {
            let d = now() - screenEnteredAt
            emit("screen_leave", ["durationMs": max(0, d)])
        }
        previousPath = (currentPath == "/") ? "" : currentPath
        currentPath = next
        pathBox.path = next
        screenEnteredAt = now()
        emit("screen_view", props)
        engine.onScreen()
    }

    // MARK: App lifecycle

    /// The SDK already emitted the initial cold foreground.
    public func appForeground(_ launch: String = "warm") {
        emit("app_foreground", ["launch": launch])
    }

    public func appBackground() {
        let d = now() - screenEnteredAt
        emit("app_background", ["durationMs": max(0, d)])
        engine.onBackground()
        queue.flushTask()
    }

    public func appTerminate() {
        emit("app_terminate")
        queue.flushTask()
    }

    // MARK: Navigation + entry points

    public func backNav() { emit("back_nav") }

    public func deepLink(_ url: String, ok: Bool = true) {
        emit("deep_link", ["url": url, "ok": ok])
    }

    public func pushOpen(_ props: [String: Any]? = nil) { emit("push_open", props) }

    // MARK: Auth + payment funnels

    public func otp(_ phase: String, props: [String: Any]? = nil) { emit("otp_\(phase)", props) }
    public func biometric(_ phase: String, props: [String: Any]? = nil) { emit("biometric_\(phase)", props) }
    public func payment(_ phase: String, props: [String: Any]? = nil) { emit("payment_\(phase)", props) }

    /// Named flows: checkout | registration | loan | kyc | onboarding | custom.
    public func flow(_ phase: String, _ flow: String, props: [String: Any]? = nil) {
        var merged = props ?? [:]
        merged["flow"] = flow
        emit("flow_\(phase)", merged)
    }

    public func permissionDenied(_ permission: String) {
        emit("permission_denied", ["permission": permission])
    }

    public func error(_ message: String) { emit("error", ["message": message]) }

    /// Custom events — also evaluates action `event` triggers + goals.
    public func track(_ name: String, props: [String: Any]? = nil) {
        var merged = props ?? [:]
        merged["name"] = name
        emit("track", merged)
        engine.onTrack(name)
    }

    /// Identify the signed-in user (bridges anonymous → known).
    public func identify(_ userId: String) {
        identity.setUserId(userId)
        emit("identify")
    }

    // MARK: Channel launchers (FAQ / Agent chat / WhatsApp)

    public func openFaq() { cta.openFaq() }
    public func openChat() { cta.openChat() }
    public func openWhatsApp() { cta.openWhatsApp() }

    /// Force a network flush (returns when the batch settled).
    public func flush() async { await queue.flush() }

    // MARK: Introspection (tests/bench)

    public func anonId() -> String { identity.getAnonId() }
    public func sessionId() -> String { identity.currentSession() }
    public func path() -> String { currentPath }
}

/// Reference box that exposes the current screen path to the helper modules
/// without retaining the client (mirrors the TS `() => currentPath` closures).
final class PathBox: @unchecked Sendable {
    var path = "/"
}
