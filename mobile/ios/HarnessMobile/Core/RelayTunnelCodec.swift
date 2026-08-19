import CryptoKit
import Foundation

struct RelayFrame: Equatable, Sendable {
    enum Kind: UInt8, Sendable { case open = 1, data = 2, fin = 3, reset = 4, ping = 5, pong = 6 }
    let kind: Kind
    let streamID: UInt32
    let payload: Data
}

actor RelayTunnelCodec {
    static let version: UInt8 = 1
    static let maximumPayload = 64 * 1024
    private let key: SymmetricKey
    private var replayOrder: [Data] = []
    private var replaySet = Set<Data>()

    init(base64URLKey: String) throws {
        guard let data = Data(base64URLEncoded: base64URLKey), data.count == 32 else { throw RelayTunnelError.invalidKey }
        key = SymmetricKey(data: data)
    }

    func seal(_ frame: RelayFrame) throws -> Data {
        guard frame.payload.count <= Self.maximumPayload else { throw RelayTunnelError.frameTooLarge }
        var plain = Data([Self.version, frame.kind.rawValue])
        var id = frame.streamID.bigEndian
        withUnsafeBytes(of: &id) { plain.append(contentsOf: $0) }
        plain.append(frame.payload)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(plain, using: key, nonce: nonce, authenticating: Data([Self.version]))
        var packet = Data([Self.version])
        packet.append(contentsOf: nonce)
        packet.append(sealed.ciphertext)
        packet.append(sealed.tag)
        return packet
    }

    func open(_ packet: Data) throws -> RelayFrame {
        guard packet.count >= 35, packet.first == Self.version else { throw RelayTunnelError.invalidPacket }
        let nonceData = packet.subdata(in: 1..<13)
        if replaySet.contains(nonceData) { throw RelayTunnelError.replay }
        let nonce = try AES.GCM.Nonce(data: nonceData)
        let tag = packet.suffix(16)
        let ciphertext = packet.subdata(in: 13..<(packet.count - 16))
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let plain: Data
        do { plain = try AES.GCM.open(box, using: key, authenticating: Data([Self.version])) }
        catch { throw RelayTunnelError.authentication }
        guard plain.count >= 6, plain[0] == Self.version, let kind = RelayFrame.Kind(rawValue: plain[1]) else { throw RelayTunnelError.invalidPacket }
        let streamID = plain[2..<6].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        let payload = plain.dropFirst(6)
        guard payload.count <= Self.maximumPayload else { throw RelayTunnelError.frameTooLarge }
        replaySet.insert(nonceData)
        replayOrder.append(nonceData)
        if replayOrder.count > 4096 { replaySet.remove(replayOrder.removeFirst()) }
        return RelayFrame(kind: kind, streamID: streamID, payload: Data(payload))
    }
}

enum RelayTunnelError: LocalizedError {
    case invalidKey, invalidPacket, authentication, replay, frameTooLarge, disconnected
    var errorDescription: String? {
        switch self {
        case .invalidKey: return "远程通道密钥无效。"
        case .invalidPacket: return "远程通道数据格式无效。"
        case .authentication: return "远程通道数据认证失败。"
        case .replay: return "远程通道拒绝了重复数据。"
        case .frameTooLarge: return "远程通道数据超过安全大小。"
        case .disconnected: return "远程通道尚未连接。"
        }
    }
}
