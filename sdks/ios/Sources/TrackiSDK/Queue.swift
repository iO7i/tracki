//
//  Queue.swift
//  Buffers events and flushes on size / interval / app-background. The ingest
//  response may carry a pending Live Assist — surfaced via the response handler.
//

import Foundation

/// Same cadence as the web snippet.
public let flushSize = 10
public let flushIntervalMs = 5000
/// /v1/events caps a batch at 50 events — split larger buffers.
let maxBatch = 50

public final class EventQueue: @unchecked Sendable {
    private let key: String
    private let eventsUrl: String
    private let identity: Identity
    private let device: DeviceInfo
    private let transport: Transport
    private let now: Clock

    private var buffer: [EventInput] = []
    private var timer: DispatchSourceTimer?
    private var onResponse: ((Any?) -> Void)?
    /// Serializes flushes so batches arrive in order (mirrors the TS inflight chain).
    private var inflight: Task<Void, Never> = Task {}
    private let lock = NSLock()

    public init(
        key: String,
        eventsUrl: String,
        identity: Identity,
        device: DeviceInfo,
        transport: Transport,
        now: @escaping Clock
    ) {
        self.key = key
        self.eventsUrl = eventsUrl
        self.identity = identity
        self.device = device
        self.transport = transport
        self.now = now
    }

    public func setResponseHandler(_ fn: @escaping (Any?) -> Void) {
        onResponse = fn
    }

    public func enqueue(_ event: EventInput) {
        identity.touchSession()
        lock.lock()
        buffer.append(event)
        let count = buffer.count
        lock.unlock()
        if count >= flushSize {
            _ = flushTask()
        } else if timer == nil {
            armTimer()
        }
    }

    private func armTimer() {
        let t = DispatchSource.makeTimerSource(queue: .global())
        t.schedule(deadline: .now() + .milliseconds(flushIntervalMs))
        t.setEventHandler { [weak self] in _ = self?.flushTask() }
        timer = t
        t.resume()
    }

    private func cancelTimer() {
        timer?.cancel()
        timer = nil
    }

    /// Send everything buffered. Serialized so batches arrive in order.
    @discardableResult
    public func flushTask() -> Task<Void, Never> {
        cancelTimer()
        lock.lock()
        if buffer.isEmpty {
            lock.unlock()
            return inflight
        }
        let events = buffer
        buffer.removeAll(keepingCapacity: true)
        lock.unlock()

        let prev = inflight
        let next = Task { [self] in
            await prev.value
            var i = 0
            while i < events.count {
                let end = min(i + maxBatch, events.count)
                let batch = Batch(
                    key: key,
                    anonId: identity.getAnonId(),
                    userId: identity.getUserId(),
                    sessionId: identity.currentSession(),
                    sentAt: now(),
                    device: device,
                    events: Array(events[i..<end])
                )
                let data = await transport.post(eventsUrl, batch.toJSON())
                if data != nil { onResponse?(data) }
                // fail-silent: transport already swallows errors and returns nil.
                i += maxBatch
            }
        }
        inflight = next
        return next
    }

    /// Await-friendly flush mirroring the reference's `flush(): Promise<void>`.
    public func flush() async {
        await flushTask().value
    }

    /// Test helper.
    public var size: Int {
        lock.lock(); defer { lock.unlock() }
        return buffer.count
    }
}
