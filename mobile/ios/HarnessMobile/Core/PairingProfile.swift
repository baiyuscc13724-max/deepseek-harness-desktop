import Foundation

struct PairingRoute: Codable, Equatable, Sendable {
    let id: String
    let host: String
    let port: UInt16
}

struct WSSRelayConfiguration: Codable, Equatable, Sendable {
    let relayURL: URL
    let roomID: String
    let tunnelKey: String
    let protocolVersion: Int
}

struct PairingProfile: Codable, Equatable, Sendable {
    static let stableHost = "harness.localhost"

    let version: Int
    let pairURL: URL
    let routes: [PairingRoute]
    let relay: WSSRelayConfiguration?

    var desktopPort: UInt16 { UInt16(pairURL.port ?? 0) }

    func stablePairURL(localPort: UInt16) -> URL {
        var components = URLComponents(url: pairURL, resolvingAgainstBaseURL: false)!
        components.scheme = "http"
        components.host = Self.stableHost
        components.port = Int(localPort)
        return components.url!
    }

    func stableOrigin(localPort: UInt16) -> URL {
        URL(string: "http://\(Self.stableHost):\(localPort)/")!
    }

    static func parse(_ rawValue: String) -> PairingProfile? {
        let raw = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        if let url = URL(string: raw), url.scheme?.lowercased() == "harnessmobile", url.host?.lowercased() == "pair" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if let payload = items.first(where: { $0.name == "payload" })?.value { return fromPayload(payload) }
            if let legacy = items.first(where: { $0.name == "url" })?.value { return fromLegacy(legacy) }
        }
        if let url = URL(string: raw), isSafeSetupURL(url), let payload = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "payload" })?.value {
            return fromPayload(payload)
        }
        return fromLegacy(raw)
    }

    static func fromStoredData(_ data: Data) -> PairingProfile? {
        try? JSONDecoder().decode(PairingProfile.self, from: data)
    }

    func storedData() throws -> Data { try JSONEncoder().encode(self) }

    private static func fromPayload(_ payload: String) -> PairingProfile? {
        guard let data = Data(base64URLEncoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let pairURLText = (object["pairUrl"] ?? object["url"]) as? String,
              let pairURL = URL(string: pairURLText), isSafeHarnessURL(pairURL, requirePairingPath: true) else { return nil }
        let version = object["version"] as? Int ?? 1
        var routes = [PairingRoute(id: "lan", host: pairURL.host!, port: UInt16(pairURL.port!))]
        var relay: WSSRelayConfiguration?
        for case let transport as [String: Any] in object["transports"] as? [[String: Any]] ?? [] {
            guard let id = transport["id"] as? String, id.range(of: "^[a-z][a-z0-9-]{1,31}$", options: .regularExpression) != nil else { continue }
            if let originText = transport["origin"] as? String, let origin = URL(string: originText), isSafeHarnessURL(origin, requirePairingPath: false),
               let host = origin.host, let port = origin.port, let safePort = UInt16(exactly: port) {
                routes.append(PairingRoute(id: id, host: host, port: safePort))
            }
            if id == "wss-relay" { relay = parseRelay(transport) }
        }
        var seen = Set<String>()
        routes = routes.filter { seen.insert("\($0.id):\($0.host):\($0.port)").inserted }
        return PairingProfile(version: version, pairURL: pairURL, routes: routes, relay: relay)
    }

    private static func fromLegacy(_ value: String) -> PairingProfile? {
        guard let url = URL(string: value), isSafeHarnessURL(url, requirePairingPath: true),
              let host = url.host, let port = url.port, let safePort = UInt16(exactly: port) else { return nil }
        return PairingProfile(version: 1, pairURL: url, routes: [PairingRoute(id: "lan", host: host, port: safePort)], relay: nil)
    }

    private static func parseRelay(_ value: [String: Any]) -> WSSRelayConfiguration? {
        guard let relayText = value["relayUrl"] as? String, let relayURL = URL(string: relayText), relayURL.scheme?.lowercased() == "wss",
              (relayURL.port == nil || relayURL.port == 443), relayURL.user == nil, relayURL.password == nil, relayURL.fragment == nil,
              let roomID = value["roomId"] as? String, roomID.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let tunnelKey = value["tunnelKey"] as? String, Data(base64URLEncoded: tunnelKey)?.count == 32,
              let protocolVersion = value["protocolVersion"] as? Int, protocolVersion == 1 else { return nil }
        return WSSRelayConfiguration(relayURL: relayURL, roomID: roomID, tunnelKey: tunnelKey, protocolVersion: protocolVersion)
    }

    static func isSafeSetupURL(_ url: URL) -> Bool {
        isSafeHarnessURL(url, requirePairingPath: false) && url.path == "/__harness_mobile__/setup"
    }

    static func isSafeHarnessURL(_ url: URL, requirePairingPath: Bool) -> Bool {
        guard url.scheme?.lowercased() == "http", let host = url.host, let port = url.port,
              (1024...65535).contains(port), isPrivateOrOverlayIPv4(host) else { return false }
        return !requirePairingPath || url.path.hasPrefix("/__harness_mobile__/pair/")
    }

    static func isPrivateOrOverlayIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else { return false }
        return parts[0] == 10 || parts[0] == 127 || (parts[0] == 192 && parts[1] == 168)
            || (parts[0] == 172 && (16...31).contains(parts[1])) || (parts[0] == 100 && (64...127).contains(parts[1]))
    }
}

extension Data {
    init?(base64URLEncoded value: String) {
        var normalized = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        self.init(base64Encoded: normalized)
    }
}
