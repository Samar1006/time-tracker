import AppKit
import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    static let defaultBaseURL = "http://127.0.0.1:4000"
    static let dashboardURL = "http://localhost:4200/dashboard"

    @Published var baseURLString: String {
        didSet { UserDefaults.standard.set(baseURLString, forKey: "apiBaseURL") }
    }
    @Published private(set) var user: UserInfo?
    @Published private(set) var connectionStatus: ConnectionStatus = .offline(queued: 0)
    @Published private(set) var trackingEnabled = false

    let tracker = AppFocusTracker()
    let eventQueue = EventQueue()

    private var token: String?
    private var apiClient: APIClient
    private var flushTask: Task<Void, Never>?

    enum ConnectionStatus: Equatable {
        case connected
        case offline(queued: Int)

        var label: String {
            switch self {
            case .connected:
                return "Connected"
            case .offline(let queued):
                return queued > 0 ? "Offline (\(queued) queued)" : "Offline"
            }
        }
    }

    init() {
        let savedURL = UserDefaults.standard.string(forKey: "apiBaseURL") ?? Self.defaultBaseURL
        baseURLString = savedURL
        apiClient = APIClient(baseURL: URL(string: savedURL)!)

        tracker.onIntervalCompleted = { [weak self] event in
            Task { @MainActor in
                await self?.handleCompletedEvent(event)
            }
        }

        restoreSession()
    }

    var isLoggedIn: Bool { token != nil && user != nil }

    var statusLine: String {
        if isLoggedIn {
            return trackingEnabled ? "Tracking: \(tracker.currentAppName)" : "Paused"
        }
        return "Not signed in"
    }

    func updateBaseURL(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil else { return }
        baseURLString = trimmed
        apiClient.baseURL = url
    }

    func login(email: String, password: String) async throws {
        let response = try await apiClient.login(email: email, password: password)
        token = response.token
        user = response.user
        try KeychainStore.saveToken(response.token, account: response.user.email)
        UserDefaults.standard.set(response.user.email, forKey: "lastAccountEmail")
        startTracking()
        await flushQueuedEvents()
    }

    func logout() {
        stopTracking()
        Task { await flushQueuedEvents() }
        if let email = user?.email {
            KeychainStore.deleteToken(account: email)
        }
        UserDefaults.standard.removeObject(forKey: "lastAccountEmail")
        token = nil
        user = nil
        connectionStatus = .offline(queued: eventQueue.queuedCount)
    }

    func restoreSession() {
        guard
            let email = UserDefaults.standard.string(forKey: "lastAccountEmail"),
            let savedToken = KeychainStore.loadToken(account: email)
        else { return }

        token = savedToken
        user = UserInfo(id: "", email: email, fullName: nil)
        startTracking()
        Task { await flushQueuedEvents() }
    }

    func startTracking() {
        guard isLoggedIn, !trackingEnabled else { return }
        trackingEnabled = true
        tracker.start()
        startPeriodicFlush()
    }

    func stopTracking() {
        trackingEnabled = false
        tracker.stop()
        flushTask?.cancel()
        flushTask = nil
    }

    func openDashboard() {
        guard let url = URL(string: Self.dashboardURL) else { return }
        NSWorkspace.shared.open(url)
    }

    private func handleCompletedEvent(_ event: ActivityEvent) async {
        eventQueue.enqueue(event)
        await flushQueuedEvents()
    }

    private func startPeriodicFlush() {
        flushTask?.cancel()
        flushTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await flushQueuedEvents()
            }
        }
    }

    private func flushQueuedEvents() async {
        guard isLoggedIn, let token, !eventQueue.isEmpty else {
            updateConnectionStatus(success: connectionStatus == .connected)
            return
        }

        let batch = eventQueue.drain()
        do {
            _ = try await apiClient.postEvents(batch, token: token)
            updateConnectionStatus(success: true)
            if !eventQueue.isEmpty {
                await flushQueuedEvents()
            }
        } catch {
            eventQueue.enqueueAll(batch)
            updateConnectionStatus(success: false)
        }
    }

    private func updateConnectionStatus(success: Bool) {
        if success && eventQueue.isEmpty {
            connectionStatus = .connected
        } else {
            connectionStatus = .offline(queued: eventQueue.queuedCount)
        }
    }
}
