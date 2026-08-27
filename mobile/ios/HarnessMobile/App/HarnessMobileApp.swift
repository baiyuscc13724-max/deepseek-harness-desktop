import SwiftUI

@main
struct HarnessMobileApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = MobileSessionViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onOpenURL { model.handleDeepLink($0) }
                .onChange(of: scenePhase) { phase in
                    guard phase == .active else { return }
                    model.sceneBecameActive()
                }
        }
    }
}
