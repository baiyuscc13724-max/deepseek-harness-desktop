import SwiftUI

@main
struct HarnessMobileApp: App {
    @StateObject private var model = MobileSessionViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .onOpenURL { model.handleDeepLink($0) }
        }
    }
}
