import SwiftUI

@main
struct TimeTrackerMacApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        MenuBarExtra("Time Tracker", systemImage: "clock.fill") {
            MenuBarView(appState: appState)
        }
        .menuBarExtraStyle(.menu)

        Window("Log in to Time Tracker", id: "login") {
            LoginView(appState: appState)
        }
        .windowResizability(.contentSize)
        .defaultPosition(.center)

        Settings {
            SettingsView(appState: appState)
        }
    }
}
