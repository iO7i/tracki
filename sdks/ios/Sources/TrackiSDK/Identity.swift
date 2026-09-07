//
//  Identity.swift
//  Visitor identity over an injected async store. Hydrated once at init; all
//  reads are then synchronous in-memory, writes persist fire-and-forget (the
//  memory copy is authoritative for the process lifetime — mirroring the
//  reference's localStorage-with-memory-fallback semantics).
//

import Foundation

let kAnonKey = "tracki_anon"
let kUserKey = "tracki_user"
let kSessionKey = "tracki_session"
let kSessionTsKey = "tracki_session_ts"

/// Same rotation rule as the web snippet: 30 min of inactivity = new session.
public let sessionTimeoutMs = 30 * 60 * 1000

/// Default id factory; `prefix_<uuid>`.
public func defaultIdFactory(_ prefix: String) -> String {
    "\(prefix)_\(UUID().uuidString.lowercased())"
}

/// Visitor identity. Construct, `await hydrate()`, then use synchronously.
public final class Identity: @unchecked Sendable {
    private let storage: KeyValueStorage
    private let now: Clock
    private let newId: IdFactory

    private var anonId = ""
    private var userId: String?
    private var sessionId = ""
    private var lastActivity = 0

    public init(storage: KeyValueStorage, now: @escaping Clock, newId: @escaping IdFactory = defaultIdFactory) {
        self.storage = storage
        self.now = now
        self.newId = newId
    }

    /// Load persisted identity; create what's missing. Call once before use.
    public func hydrate() async {
        async let a = storage.get(kAnonKey)
        async let u = storage.get(kUserKey)
        async let s = storage.get(kSessionKey)
        async let t = storage.get(kSessionTsKey)
        let anon = await a
        let user = await u
        let sess = await s
        let ts = await t

        if let anon, !anon.isEmpty {
            anonId = anon
        } else {
            anonId = persist(kAnonKey, newId("anon"))
        }
        userId = (user?.isEmpty == false) ? user : nil
        sessionId = sess ?? ""
        lastActivity = Int(ts ?? "0") ?? 0
        // Ensure a valid session exists (also rotates an expired persisted one).
        _ = touchSession()
    }

    @discardableResult
    private func persist(_ key: String, _ value: String) -> String {
        let storage = self.storage
        Task { await storage.set(key, value) }
        return value
    }

    public func getAnonId() -> String { anonId }

    public func getUserId() -> String? { userId }

    public func setUserId(_ userId: String) {
        self.userId = userId
        _ = persist(kUserKey, userId)
    }

    /// Current session id; rotates after 30 min of inactivity, stamps activity.
    @discardableResult
    public func touchSession() -> String {
        let t = now()
        if sessionId.isEmpty || t - lastActivity > sessionTimeoutMs {
            sessionId = persist(kSessionKey, newId("sess"))
        }
        lastActivity = t
        _ = persist(kSessionTsKey, String(t))
        return sessionId
    }

    /// Read without stamping activity (used when building batches).
    public func currentSession() -> String { sessionId }
}
