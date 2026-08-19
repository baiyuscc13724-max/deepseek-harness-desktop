import XCTest
@testable import HarnessMobile

final class RelayTunnelCodecTests: XCTestCase {
    func testOpensNodeGeneratedAESGCMVectorAndRejectsReplay() async throws {
        let codec = try RelayTunnelCodec(base64URLKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc")
        let packet = try XCTUnwrap(Data(hex: "01000102030405060708090a0b1983e9701d23a93b1ec484e887781c9b9850d9ef7c1353fcafca71c638a5771489d6931d56"))
        let frame = try await codec.open(packet)
        XCTAssertEqual(frame.kind, .data)
        XCTAssertEqual(frame.streamID, 42)
        XCTAssertEqual(String(decoding: frame.payload, as: UTF8.self), "private payload")
        do {
            _ = try await codec.open(packet)
            XCTFail("Replay must be rejected")
        } catch RelayTunnelError.replay {}
    }

    func testRoundTripsMaximumNormalFrame() async throws {
        let codec = try RelayTunnelCodec(base64URLKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc")
        let packet = try await codec.seal(RelayFrame(kind: .data, streamID: 7, payload: Data("hello".utf8)))
        let frame = try await codec.open(packet)
        XCTAssertEqual(frame.streamID, 7)
        XCTAssertEqual(frame.payload, Data("hello".utf8))
    }
}

private extension Data {
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2) else { return nil }
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
