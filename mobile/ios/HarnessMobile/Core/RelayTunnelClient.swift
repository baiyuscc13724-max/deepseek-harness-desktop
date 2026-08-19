import Foundation

actor RelayTunnelClient {
    struct StreamCallbacks: Sendable {
        let onData: @Sendable (Data) -> Void
        let onClose: @Sendable (Error?) -> Void
    }

    private let configuration: WSSRelayConfiguration
    private let codec: RelayTunnelCodec
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var streams: [UInt32: StreamCallbacks] = [:]
    private var nextStreamID: UInt32 = 1
    private(set) var connected = false

    init(configuration: WSSRelayConfiguration, session: URLSession = .shared) throws {
        self.configuration = configuration
        self.codec = try RelayTunnelCodec(base64URLKey: configuration.tunnelKey)
        self.session = session
    }

    func connect() async throws {
        if connected { return }
        let task = session.webSocketTask(with: configuration.relayURL)
        socket = task
        task.resume()
        let hello: [String: Any] = ["type": "hello", "version": 1, "role": "mobile", "roomId": configuration.roomID]
        let data = try JSONSerialization.data(withJSONObject: hello)
        try await task.send(.string(String(decoding: data, as: UTF8.self)))
        let first = try await task.receive()
        guard case .string(let text) = first,
              let object = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              object["type"] as? String == "welcome", object["role"] as? String == "mobile",
              object["desktopOnline"] as? Bool != false else {
            task.cancel(with: .protocolError, reason: nil)
            throw RelayTunnelError.disconnected
        }
        connected = true
        Task { await receiveLoop(task) }
    }

    func openStream(callbacks: StreamCallbacks) async throws -> UInt32 {
        try await connect()
        let streamID = nextStreamID
        nextStreamID &+= 2
        if nextStreamID == 0 { nextStreamID = 1 }
        streams[streamID] = callbacks
        try await send(RelayFrame(kind: .open, streamID: streamID, payload: Data()))
        return streamID
    }

    func send(streamID: UInt32, data: Data) async throws {
        var offset = 0
        while offset < data.count {
            let end = min(offset + RelayTunnelCodec.maximumPayload, data.count)
            try await send(RelayFrame(kind: .data, streamID: streamID, payload: data.subdata(in: offset..<end)))
            offset = end
        }
    }

    func finish(streamID: UInt32) async {
        try? await send(RelayFrame(kind: .fin, streamID: streamID, payload: Data()))
    }

    func reset(streamID: UInt32) async {
        streams.removeValue(forKey: streamID)?.onClose(nil)
        try? await send(RelayFrame(kind: .reset, streamID: streamID, payload: Data()))
    }

    func disconnect() {
        connected = false
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        let callbacks = streams.values
        streams.removeAll()
        callbacks.forEach { $0.onClose(RelayTunnelError.disconnected) }
    }

    private func send(_ frame: RelayFrame) async throws {
        guard connected, let socket else { throw RelayTunnelError.disconnected }
        let encrypted = try await codec.seal(frame)
        var envelope = Data(repeating: 0, count: 8)
        envelope.append(encrypted)
        try await socket.send(.data(envelope))
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask) async {
        do {
            while connected {
                let message = try await task.receive()
                switch message {
                case .data(let envelope):
                    guard envelope.count > 8, envelope.prefix(8).allSatisfy({ $0 == 0 }) else { throw RelayTunnelError.invalidPacket }
                    let frame = try await codec.open(Data(envelope.dropFirst(8)))
                    await handle(frame)
                case .string(let text):
                    if text.contains("desktop-offline") { throw RelayTunnelError.disconnected }
                @unknown default: break
                }
            }
        } catch {
            connected = false
            socket = nil
            let callbacks = streams.values
            streams.removeAll()
            callbacks.forEach { $0.onClose(error) }
        }
    }

    private func handle(_ frame: RelayFrame) async {
        switch frame.kind {
        case .data: streams[frame.streamID]?.onData(frame.payload)
        case .fin:
            streams.removeValue(forKey: frame.streamID)?.onClose(nil)
        case .reset:
            streams.removeValue(forKey: frame.streamID)?.onClose(RelayTunnelError.disconnected)
        case .ping:
            try? await send(RelayFrame(kind: .pong, streamID: frame.streamID, payload: Data()))
        case .open, .pong: break
        }
    }
}
