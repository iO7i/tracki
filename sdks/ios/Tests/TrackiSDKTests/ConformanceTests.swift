//
//  ConformanceTests.swift
//  The Swift SDK must reproduce the shared conformance fixtures (as parsed
//  JSON). The TS reference + Flutter/Kotlin SDKs assert the SAME files — this is
//  what keeps the codebases on one protocol. Fixtures are loaded relative to
//  #filePath (…/sdks/ios/Tests/TrackiSDKTests → …/sdks/conformance) and compared
//  as NSDictionary for deep, order-independent equality.
//

import XCTest
@testable import TrackiSDK

// MARK: - Test doubles

final class MemoryStorage: KeyValueStorage, @unchecked Sendable {
    private var data: [String: String] = [:]
    private let lock = NSLock()
    func get(_ key: String) async -> String? { lock.lock(); defer { lock.unlock() }; return data[key] }
    func set(_ key: String, _ value: String) async { lock.lock(); data[key] = value; lock.unlock() }
}

final class CapturingTransport: Transport, @unchecked Sendable {
    struct Post { let url: String; let body: [String: Any] }
    private(set) var posts: [Post] = []
    private let lock = NSLock()

    func post(_ url: String, _ body: [String: Any]) async -> Any? {
        // Round-trip through JSONSerialization exactly like a real transport,
        // so absent (nil) keys never appear in the captured body.
        let data = try! JSONSerialization.data(withJSONObject: body)
        let normalized = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        lock.lock(); posts.append(Post(url: url, body: normalized)); lock.unlock()
        return ["ok": true]
    }

    func get(_ url: String) async -> Any? { ["actions": []] }
}

final class ListRenderer: Renderer, @unchecked Sendable {
    var intents: [RenderIntent] = []
    func show(_ intent: RenderIntent) { intents.append(intent) }
}

// MARK: - Fixture loading

private func loadFixture(_ name: String) -> [String: Any] {
    // …/sdks/ios/Tests/TrackiSDKTests/ConformanceTests.swift → …/sdks/conformance
    let here = URL(fileURLWithPath: #filePath)
    let conformance = here
        .deletingLastPathComponent() // → …/Tests/TrackiSDKTests
        .deletingLastPathComponent() // → …/ios/Tests
        .deletingLastPathComponent() // → …/sdks/ios
        .deletingLastPathComponent() // → …/sdks
        .appendingPathComponent("conformance")
        .appendingPathComponent(name)
    let data = try! Data(contentsOf: conformance)
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
}

// MARK: - Journey runner

private func runJourney(renderer: Renderer? = nil) async -> (Tracki, CapturingTransport) {
    let journey = loadFixture("journey-batch.json")
    let config = journey["config"] as! [String: Any]
    let device = DeviceInfo.from(json: config["device"] as! [String: Any])
    let transport = CapturingTransport()

    let clockBox = ClockBox(1_700_000_000_000)
    let counters = CounterBox()

    let client = await Tracki.create(TrackiConfig(
        key: config["key"] as! String,
        endpoint: config["endpoint"] as! String,
        device: device,
        storage: MemoryStorage(),
        locale: config["locale"] as? String,
        renderer: renderer,
        transport: transport,
        clock: { clockBox.value },
        idFactory: { prefix in counters.next(prefix) }
    ))
    await client.ready

    for step in journey["script"] as! [[String: Any]] {
        clockBox.value += 1000 // +1000ms before each step
        dispatch(client, step["call"] as! String, step["args"] as! [Any])
    }
    await client.flush()
    return (client, transport)
}

private func dispatch(_ c: Tracki, _ call: String, _ args: [Any]) {
    func props(_ i: Int) -> [String: Any]? { args.count > i ? (args[i] as? [String: Any]) : nil }
    switch call {
    case "screen": c.screen(args[0] as! String, props: props(1))
    case "otp": c.otp(args[0] as! String, props: props(1))
    case "biometric": c.biometric(args[0] as! String, props: props(1))
    case "payment": c.payment(args[0] as! String, props: props(1))
    case "flow": c.flow(args[0] as! String, args[1] as! String, props: props(2))
    case "track": c.track(args[0] as! String, props: props(1))
    case "identify": c.identify(args[0] as! String)
    case "deepLink": c.deepLink(args[0] as! String, ok: args.count > 1 ? (args[1] as! Bool) : true)
    case "pushOpen": c.pushOpen(props(0))
    case "backNav": c.backNav()
    case "appForeground": c.appForeground(args.isEmpty ? "warm" : (args[0] as! String))
    case "appBackground": c.appBackground()
    case "error": c.error(args[0] as! String)
    case "permissionDenied": c.permissionDenied(args[0] as! String)
    default: fatalError("unknown scripted call: \(call)")
    }
}

final class ClockBox: @unchecked Sendable {
    var value: Int
    init(_ v: Int) { value = v }
}

final class CounterBox: @unchecked Sendable {
    private var counters: [String: Int] = [:]
    private let lock = NSLock()
    func next(_ prefix: String) -> String {
        lock.lock(); defer { lock.unlock() }
        counters[prefix, default: 0] += 1
        return "\(prefix)_\(counters[prefix]!)"
    }
}

// MARK: - Tests

final class ConformanceTests: XCTestCase {

    func testPickVariantReplicatesJSHash() {
        // Known values computed from the TS reference logic
        //   h = (h*31 + code)|0 over "anonId:actionId"; abs(h)%2 → A/B.
        XCTAssertEqual(pickVariant("anon_1", "act-1", false), "A") // hasB=false ⇒ A
        XCTAssertEqual(pickVariant("anon_1", "act-1", true), "A")  // even hash
        XCTAssertEqual(pickVariant("anon_2", "act-1", true), "B")  // odd hash
    }

    func testProducesExpectedEventsBatch() async {
        let journey = loadFixture("journey-batch.json")
        let (_, transport) = await runJourney()
        let batches = transport.posts.filter { $0.url.hasSuffix("/v1/events") }
        XCTAssertEqual(batches.count, 1)
        let expected = journey["expectedBatch"] as! [String: Any]
        XCTAssertEqual(batches[0].body as NSDictionary, expected as NSDictionary)
    }

    func testMintsExactWhatsAppHandoffBody() async {
        let channels = loadFixture("channel-requests.json")
        let (client, transport) = await runJourney()
        client.openWhatsApp()
        // Let the handoff Task settle.
        try? await Task.sleep(nanoseconds: 50_000_000)
        let spec = channels["whatsappHandoff"] as! [String: Any]
        let url = spec["url"] as! String
        let handoff = transport.posts.first { $0.url.hasSuffix(url) }
        XCTAssertNotNil(handoff)
        XCTAssertEqual(handoff!.body as NSDictionary, (spec["body"] as! [String: Any]) as NSDictionary)
    }

    func testSendsExactFirstChatTurn() async {
        let channels = loadFixture("channel-requests.json")
        let renderer = ListRenderer()
        let (client, transport) = await runJourney(renderer: renderer)
        client.openChat()
        guard case let .chat(chat)? = renderer.intents.first(where: { if case .chat = $0 { return true }; return false }) else {
            XCTFail("no chat intent"); return
        }
        let spec = channels["chatFirstTurn"] as! [String: Any]
        _ = await chat.send(spec["messageUsed"] as! String)
        let url = spec["url"] as! String
        let turn = transport.posts.first { $0.url.hasSuffix(url) }
        XCTAssertNotNil(turn)
        XCTAssertEqual(turn!.body as NSDictionary, (spec["body"] as! [String: Any]) as NSDictionary)
    }
}
