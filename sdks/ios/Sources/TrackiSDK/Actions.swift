//
//  Actions.swift
//  Mobile action engine — the snippet's actions runtime re-imagined for apps:
//  screen_view plays the role of pageview, app_background plays exit_intent,
//  `event` fires on track(); struggle actions stay server-driven (Live Assist).
//  Frequency caps persist across launches in one storage-backed JSON map.
//

import Foundation

// Local mirror of the mobile manifest entry (zero deps, like the snippet's).
struct ManifestLocalized {
    var title: String
    var body: String
    var cta: CtaContent?

    static func from(_ j: [String: Any]) -> ManifestLocalized {
        var cta: CtaContent?
        if let c = j["cta"] as? [String: Any] {
            cta = CtaContent(
                label: "\(c["label"] ?? "")",
                kind: c["kind"] as? String,
                url: c["url"] as? String,
                faq: c["faq"] as? Bool
            )
        }
        return ManifestLocalized(
            title: "\(j["title"] ?? "")",
            body: "\(j["body"] ?? "")",
            cta: cta
        )
    }
}

struct ManifestStep {
    var ar: (title: String, body: String)
    var en: (title: String, body: String)
    var anchor: String?
}

struct ManifestAction {
    var id: String
    var type: String // popup | banner | tooltip | tour | drawer
    var arContent: ManifestLocalized
    var enContent: ManifestLocalized
    var arContentB: ManifestLocalized?
    var enContentB: ManifestLocalized?
    var triggerKind: String
    var triggerSeconds: Int?
    var triggerEventName: String?
    var urlContains: String?
    var frequencyCap: Int?
    var goalEvent: String?
    var anchorSelector: String?
    var steps: [ManifestStep]?

    var hasB: Bool { arContentB != nil || enContentB != nil }

    static func from(_ raw: Any) -> ManifestAction? {
        guard let m = raw as? [String: Any],
              let id = m["id"] as? String,
              let type = m["type"] as? String,
              let content = m["content"] as? [String: Any],
              let trigger = m["trigger"] as? [String: Any] else { return nil }

        let contentB = m["contentB"] as? [String: Any]
        var steps: [ManifestStep]?
        if let rawSteps = m["steps"] as? [[String: Any]] {
            steps = rawSteps.map { s in
                let ar = s["ar"] as? [String: Any] ?? [:]
                let en = s["en"] as? [String: Any] ?? [:]
                return ManifestStep(
                    ar: ("\(ar["title"] ?? "")", "\(ar["body"] ?? "")"),
                    en: ("\(en["title"] ?? "")", "\(en["body"] ?? "")"),
                    anchor: s["anchor"] as? String
                )
            }
        }

        return ManifestAction(
            id: id,
            type: type,
            arContent: ManifestLocalized.from(content["ar"] as? [String: Any] ?? [:]),
            enContent: ManifestLocalized.from(content["en"] as? [String: Any] ?? [:]),
            arContentB: (contentB?["ar"] as? [String: Any]).map(ManifestLocalized.from),
            enContentB: (contentB?["en"] as? [String: Any]).map(ManifestLocalized.from),
            triggerKind: "\(trigger["kind"] ?? "")",
            triggerSeconds: (trigger["seconds"] as? NSNumber)?.intValue,
            triggerEventName: trigger["eventName"] as? String,
            urlContains: m["urlContains"] as? String,
            frequencyCap: (m["frequencyCap"] as? NSNumber)?.intValue,
            goalEvent: m["goalEvent"] as? String,
            anchorSelector: m["anchorSelector"] as? String,
            steps: steps
        )
    }
}

let capsKey = "tracki_caps"

/// Stable 50/50 split per visitor (mirrors shared pickVariant). Replicates the
/// JS `(h * 31 + code) | 0` 32-bit signed overflow exactly via Int32 wrapping
/// arithmetic (`&*`, `&+`).
public func pickVariant(_ anonId: String, _ actionId: String, _ hasB: Bool) -> String {
    if !hasB { return "A" }
    var h: Int32 = 0
    // JS charCodeAt yields UTF-16 code units; iterate utf16 for an exact match.
    for unit in "\(anonId):\(actionId)".utf16 {
        h = h &* 31 &+ Int32(unit)
    }
    // abs(Int32.min) overflows; widen to Int first (parity of the magnitude is
    // all that %2 depends on, matching JS Math.abs(h) % 2).
    let magnitude = abs(Int(h))
    return magnitude % 2 == 0 ? "A" : "B"
}

public final class ActionEngine: @unchecked Sendable {
    let key: String
    let endpoint: String
    let locale: () -> String
    let currentPath: () -> String
    let anonId: () -> String
    let queue: EventQueue
    let transport: Transport
    let storage: KeyValueStorage
    weak var renderer: Renderer?
    let cta: CtaRouter
    let now: Clock

    private var actions: [ManifestAction] = []
    private var shownThisScreen = Set<String>()
    private var shownThisSession = Set<String>()
    private var caps: [String: Int] = [:]
    private var capsLoaded = false
    private var timers: [DispatchSourceTimer] = []

    public init(
        key: String,
        endpoint: String,
        locale: @escaping () -> String,
        currentPath: @escaping () -> String,
        anonId: @escaping () -> String,
        queue: EventQueue,
        transport: Transport,
        storage: KeyValueStorage,
        renderer: Renderer?,
        cta: CtaRouter,
        now: @escaping Clock
    ) {
        self.key = key
        self.endpoint = endpoint
        self.locale = locale
        self.currentPath = currentPath
        self.anonId = anonId
        self.queue = queue
        self.transport = transport
        self.storage = storage
        self.renderer = renderer
        self.cta = cta
        self.now = now
    }

    private func emit(_ type: String, _ actionId: String, _ variant: String, _ channel: String? = nil) {
        var props: [String: Any] = ["action_id": actionId, "variant": variant]
        if let channel { props["channel"] = channel }
        queue.enqueue(EventInput(type: type, ts: now(), path: currentPath(), props: props))
    }

    private func loadCaps() async {
        if let raw = await storage.get(capsKey),
           let data = raw.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            var loaded: [String: Int] = [:]
            for (k, v) in obj { if let n = v as? NSNumber { loaded[k] = n.intValue } }
            caps = loaded
        } else {
            caps = [:]
        }
        capsLoaded = true
    }

    private func bumpCap(_ a: ManifestAction) {
        caps[a.id] = (caps[a.id] ?? 0) + 1
        if let data = try? JSONSerialization.data(withJSONObject: caps),
           let str = String(data: data, encoding: .utf8) {
            let storage = self.storage
            Task { await storage.set(capsKey, str) }
        }
    }

    private func localized(_ a: ManifestAction, _ variant: String) -> LocalizedContent {
        let L = locale()
        if variant == "B", a.hasB {
            let b = (L == "en") ? (a.enContentB ?? a.arContentB) : (a.arContentB ?? a.enContentB)
            if let b {
                return LocalizedContent(title: b.title, body: b.body, cta: b.cta)
            }
        }
        let pack = (L == "en") ? a.enContent : a.arContent
        return LocalizedContent(title: pack.title, body: pack.body, cta: pack.cta)
    }

    private func tourSteps(_ a: ManifestAction) -> [TourStepContent]? {
        guard a.type == "tour", let steps = a.steps, !steps.isEmpty else { return nil }
        let L = locale()
        return steps.map { s in
            let m = (L == "en") ? s.en : s.ar
            return TourStepContent(title: m.title, body: m.body, anchor: s.anchor)
        }
    }

    private func maybeShow(_ a: ManifestAction) {
        guard let renderer else { return }
        if shownThisScreen.contains(a.id) { return }
        if let uc = a.urlContains, !currentPath().contains(uc) { return }
        if let cap = a.frequencyCap, (caps[a.id] ?? 0) >= cap { return }
        let variant = pickVariant(anonId(), a.id, a.hasB)
        let content = localized(a, variant)
        var rendered = true
        let intent = ActionIntent(
            actionId: a.id,
            type: a.type,
            variant: variant,
            content: content,
            steps: tourSteps(a),
            anchor: a.anchorSelector,
            activateCta: { [weak self] in
                guard let self, let cta = content.cta else { return }
                let kind = self.cta.activate(cta)
                self.emit("action_click", a.id, variant, kind.rawValue)
            },
            dismiss: { [weak self] in self?.emit("action_dismiss", a.id, variant) }
        )
        // A failed render MUST NOT count: no impression, no cap bump, no goal
        // arm (slice-3 M1 parity). The plain Renderer can't throw, so a renderer
        // that needs to reject a render adopts ThrowingRenderer and throws from
        // tryShow — we then skip everything below.
        if let throwing = renderer as? ThrowingRenderer {
            do { try throwing.tryShow(.action(intent)) }
            catch { rendered = false }
        } else {
            renderer.show(.action(intent))
        }
        guard rendered else { return }
        shownThisScreen.insert(a.id)
        shownThisSession.insert(a.id)
        bumpCap(a)
        emit("action_impression", a.id, variant)
    }

    private func evaluateScreen() {
        for a in actions where a.triggerKind == "pageview" { maybeShow(a) }
    }

    /// Fetch the mobile-surface manifest, then arm time-based triggers.
    public func start() async {
        await loadCaps()
        let k = key.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? key
        let data = await transport.get("\(endpoint)/v1/actions?key=\(k)&surface=mobile")
        if let dict = data as? [String: Any], let list = dict["actions"] as? [Any] {
            for raw in list { if let a = ManifestAction.from(raw) { actions.append(a) } }
        }
        evaluateScreen()
        for a in actions where a.triggerKind == "time_on_page" {
            let secs = a.triggerSeconds ?? 5
            let t = DispatchSource.makeTimerSource(queue: .global())
            t.schedule(deadline: .now() + .seconds(secs))
            t.setEventHandler { [weak self] in self?.maybeShow(a) }
            timers.append(t)
            t.resume()
        }
    }

    /// New screen — screen-scoped impressions reset, pageview triggers re-run.
    public func onScreen() {
        shownThisScreen.removeAll(keepingCapacity: true)
        if capsLoaded { evaluateScreen() }
    }

    /// App went to background — the mobile analogue of exit intent.
    public func onBackground() {
        for a in actions where a.triggerKind == "exit_intent" { maybeShow(a) }
    }

    /// A custom event — event triggers + goal attribution.
    public func onTrack(_ name: String) {
        for a in actions {
            if a.triggerKind == "event", a.triggerEventName == name { maybeShow(a) }
            if a.goalEvent == name, shownThisSession.contains(a.id) {
                emit("action_goal", a.id, pickVariant(anonId(), a.id, a.hasB))
            }
        }
    }

    /// Test seam.
    public var loadedCount: Int { actions.count }
}

/// Optional renderer extension: a renderer may reject a render by throwing.
/// A throwing render is treated as a failed render (no impression / cap / goal),
/// matching the TS "a failed render is NOT an impression" rule.
public protocol ThrowingRenderer: Renderer {
    func tryShow(_ intent: RenderIntent) throws
}
