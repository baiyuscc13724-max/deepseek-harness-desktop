import Foundation
import Network

protocol ProxyByteChannel: AnyObject, Sendable {
    var onData: (@Sendable (Data) -> Void)? { get set }
    var onClose: (@Sendable (Error?) -> Void)? { get set }
    func send(_ data: Data)
    func close()
}

final class NWProxyChannel: ProxyByteChannel, @unchecked Sendable {
    var onData: (@Sendable (Data) -> Void)?
    var onClose: (@Sendable (Error?) -> Void)?
    private let connection: NWConnection
    private var closed = false

    init(connection: NWConnection) { self.connection = connection }

    func start() { receive() }
    func send(_ data: Data) { connection.send(content: data, completion: .contentProcessed { [weak self] error in if let error { self?.finish(error) } }) }
    func close() { finish(nil) }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
            guard let self else { return }
            if let data, !data.isEmpty { self.onData?(data) }
            if complete || error != nil { self.finish(error) } else { self.receive() }
        }
    }

    private func finish(_ error: Error?) {
        guard !closed else { return }
        closed = true
        connection.cancel()
        onClose?(error)
    }
}

final class RelayProxyChannel: ProxyByteChannel, @unchecked Sendable {
    var onData: (@Sendable (Data) -> Void)?
    var onClose: (@Sendable (Error?) -> Void)?
    private let client: RelayTunnelClient
    private var streamID: UInt32?

    init(client: RelayTunnelClient) { self.client = client }

    func start() async throws {
        streamID = try await client.openStream(callbacks: .init(
            onData: { [weak self] data in self?.onData?(data) },
            onClose: { [weak self] error in self?.onClose?(error) }
        ))
    }

    func send(_ data: Data) {
        guard let streamID else { return }
        Task { try? await client.send(streamID: streamID, data: data) }
    }

    func close() {
        guard let streamID else { return }
        self.streamID = nil
        Task { await client.finish(streamID: streamID) }
    }
}

actor RouteCoordinator {
    private var profile: PairingProfile
    private var relayClient: RelayTunnelClient?

    init(profile: PairingProfile) { self.profile = profile }

    func update(profile: PairingProfile) async {
        self.profile = profile
        if let relayClient { await relayClient.disconnect() }
        relayClient = nil
    }

    func networkChanged() async {
        if let relayClient { await relayClient.disconnect() }
        relayClient = nil
    }

    func connect() async throws -> ProxyByteChannel {
        if let route = profile.routes.first(where: { $0.id == "lan" }), let direct = try? await connectLAN(route) { return direct }
        guard let relay = profile.relay else { throw RelayTunnelError.disconnected }
        let client: RelayTunnelClient
        if let relayClient { client = relayClient }
        else {
            client = try RelayTunnelClient(configuration: relay)
            relayClient = client
        }
        let channel = RelayProxyChannel(client: client)
        try await channel.start()
        return channel
    }

    private func connectLAN(_ route: PairingRoute) async throws -> NWProxyChannel {
        let parameters = NWParameters.tcp
        let connection = NWConnection(host: NWEndpoint.Host(route.host), port: NWEndpoint.Port(rawValue: route.port)!, using: parameters)
        return try await withCheckedThrowingContinuation { continuation in
            let queue = DispatchQueue(label: "io.harnessdesktop.mobile.lan-connect")
            var resumed = false
            connection.stateUpdateHandler = { state in
                guard !resumed else { return }
                switch state {
                case .ready:
                    resumed = true
                    continuation.resume(returning: NWProxyChannel(connection: connection))
                case .failed(let error), .waiting(let error):
                    resumed = true
                    connection.cancel()
                    continuation.resume(throwing: error)
                default: break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 1.2) {
                guard !resumed else { return }
                resumed = true
                connection.cancel()
                continuation.resume(throwing: URLError(.timedOut))
            }
        }
    }
}

final class LoopbackProxy: @unchecked Sendable {
    private let queue = DispatchQueue(label: "io.harnessdesktop.mobile.loopback-proxy")
    private var listener: NWListener?
    private var clients = [ObjectIdentifier: NWConnection]()
    private let routes: RouteCoordinator
    private(set) var port: UInt16 = 0

    init(profile: PairingProfile) { routes = RouteCoordinator(profile: profile) }

    func start() async throws -> UInt16 {
        if port > 0 { return port }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        return try await withCheckedThrowingContinuation { continuation in
            var resumed = false
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    guard !resumed, let assigned = listener.port else { return }
                    resumed = true
                    self.port = assigned.rawValue
                    continuation.resume(returning: assigned.rawValue)
                case .failed(let error):
                    guard !resumed else { return }
                    resumed = true
                    continuation.resume(throwing: error)
                default: break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
            listener.start(queue: queue)
        }
    }

    func update(profile: PairingProfile) { Task { await routes.update(profile: profile) } }
    func networkChanged() { Task { await routes.networkChanged() } }

    func stop() {
        listener?.cancel()
        listener = nil
        port = 0
        clients.values.forEach { $0.cancel() }
        clients.removeAll()
    }

    private func accept(_ client: NWConnection) {
        let id = ObjectIdentifier(client)
        clients[id] = client
        client.start(queue: queue)
        Task {
            do {
                let upstream = try await routes.connect()
                upstream.onData = { data in client.send(content: data, completion: .idempotent) }
                upstream.onClose = { [weak self] _ in client.cancel(); self?.clients.removeValue(forKey: id) }
                pump(client, to: upstream, id: id)
                if let direct = upstream as? NWProxyChannel { direct.start() }
            } catch {
                client.cancel()
                clients.removeValue(forKey: id)
            }
        }
    }

    private func pump(_ client: NWConnection, to upstream: ProxyByteChannel, id: ObjectIdentifier) {
        client.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
            if let data, !data.isEmpty { upstream.send(data) }
            if complete || error != nil {
                upstream.close()
                client.cancel()
                self?.clients.removeValue(forKey: id)
            } else {
                self?.pump(client, to: upstream, id: id)
            }
        }
    }
}
