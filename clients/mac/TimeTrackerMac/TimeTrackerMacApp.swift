import SwiftUI

@main
struct TimeTrackerMacApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        MenuBarExtra("Time Tracker", systemImage: "clock.fill") {
            MenuBarView(appState: appState)
                .sheet(isPresented: $appState.showLoginSheet) {
                    LoginView(appState: appState)
                }
        }
        .menuBarExtraStyle(.menu)

        Settings {
            SettingsView(appState: appState)
        }
    }
}
