import XCTest
@testable import HarnessMobile

final class PairingProfileTests: XCTestCase {
    func testParsesLANAndCredentialFreeWSSRelay() throws {
        let room = String(repeating: "r", count: 43)
        let key = String(repeating: "k", count: 43)
        let object: [String: Any] = [
            "version": 2,
            "pairUrl": "http://192.168.1.20:3081/__harness_mobile__/pair/once",
            "transports": [[
                "id": "wss-relay",
                "origin": "http://10.253.77.254:3081",
                "relayUrl": "wss://relay.example.com/tunnel",
                "roomId": room,
                "tunnelKey": key,
                "protocolVersion": 1
            ]]
        ]
        let data = try JSONSerialization.data(withJSONObject: object)
        let payload = data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let profile = try XCTUnwrap(PairingProfile.parse("harnessmobile://pair?payload=\(payload)"))
        XCTAssertEqual(profile.routes.map(\.id), ["lan", "wss-relay"])
        XCTAssertEqual(profile.relay?.relayURL.absoluteString, "wss://relay.example.com/tunnel")
        XCTAssertEqual(profile.stablePairURL(localPort: 49152).host, PairingProfile.stableHost)
    }

    func testRejectsPublicPairingTargetsAndRelayCredentials() throws {
        XCTAssertNil(PairingProfile.parse("http://example.com:3081/__harness_mobile__/pair/token"))
        XCTAssertNil(PairingProfile.parse("https://192.168.1.2:3081/__harness_mobile__/pair/token"))
    }
}
