//
//  Transport.swift
//  Default transport over URLSession. Fail-silent: errors resolve to nil so the
//  callers (queue / router) decide what to do — telemetry never throws into the
//  host app.
//

import Foundation

public struct URLSessionTransport: Transport {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func post(_ url: String, _ body: [String: Any]) async -> Any? {
        guard let u = URL(string: url),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = data
        return await send(req)
    }

    public func get(_ url: String) async -> Any? {
        guard let u = URL(string: url) else { return nil }
        return await send(URLRequest(url: u))
    }

    private func send(_ req: URLRequest) async -> Any? {
        guard let (data, _) = try? await session.data(for: req) else { return nil }
        if data.isEmpty { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }
}

/// Convenience constructor mirroring the reference's `fetchTransport()`.
public func urlSessionTransport() -> Transport { URLSessionTransport() }
