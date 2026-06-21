import SwiftUI

struct MenuBarView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        Group {
            Text(appState.statusLine)
                .disabled(true)

            Text(appState.connectionStatus.label)
                .disabled(true)

            Divider()

            if appState.isLoggedIn {
                Button(appState.trackingEnabled ? "Pause tracking" : "Resume tracking") {
                    if appState.trackingEnabled {
                        appState.stopTracking()
                    } else {
                        appState.startTracking()
                    }
                }

                Button("Log out") {
                    appState.logout()
                }
            } else {
                Button("Log in…") {
                    appState.showLoginSheet = true
                }
            }

            Button("Open dashboard") {
                appState.openDashboard()
            }

            Divider()

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }
    }
}

struct SettingsView: View {
    @ObservedObject var appState: AppState

    var body: some View {
        Form {
            TextField("API base URL", text: $appState.baseURLString)
                .onSubmit {
                    appState.updateBaseURL(appState.baseURLString)
                }
            Button("Apply URL") {
                appState.updateBaseURL(appState.baseURLString)
            }
        }
        .padding()
        .frame(width: 360)
    }
}
