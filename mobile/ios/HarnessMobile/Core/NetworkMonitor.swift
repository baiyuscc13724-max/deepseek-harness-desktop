import Foundation
import Network

@MainActor
final class NetworkMonitor: ObservableObject {
    @Published private(set) var available = false
    @Published private(set) var localNetworkLikelyAvailable = false
    @Published private(set) var generation: UInt64 = 0

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "io.harnessdesktop.mobile.network-monitor")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let nextAvailable = path.status == .satisfied
                let nextLocal = path.usesInterfaceType(.wifi) || path.usesInterfaceType(.wiredEthernet)
                if nextAvailable != self.available || nextLocal != self.localNetworkLikelyAvailable {
                    self.available = nextAvailable
                    self.localNetworkLikelyAvailable = nextLocal
                    self.generation &+= 1
                }
            }
        }
        monitor.start(queue: queue)
    }

    deinit { monitor.cancel() }
}
