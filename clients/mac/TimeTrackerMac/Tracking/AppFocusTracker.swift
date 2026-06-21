import AppKit
import Foundation

@MainActor
final class AppFocusTracker: ObservableObject {
    @Published private(set) var currentAppName: String = "—"
    @Published private(set) var isTracking = false

    var onIntervalCompleted: ((ActivityEvent) -> Void)?

    private var currentInterval: FocusInterval?
    private var workspaceObserver: NSObjectProtocol?
    private var flushTimer: Timer?
    private let flushIntervalSec: TimeInterval

    init(flushIntervalSec: TimeInterval = 60) {
        self.flushIntervalSec = flushIntervalSec
    }

    func start() {
        guard !isTracking else { return }
        isTracking = true

        workspaceObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                self?.handleActivation(notification)
            }
        }

        beginInterval(for: NSWorkspace.shared.frontmostApplication)
        startFlushTimer()
    }

    func stop() {
        guard isTracking else { return }
        flushCurrentInterval()
        isTracking = false

        if let workspaceObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(workspaceObserver)
            self.workspaceObserver = nil
        }

        flushTimer?.invalidate()
        flushTimer = nil
        currentInterval = nil
        currentAppName = "—"
    }

    private func handleActivation(_ notification: Notification) {
        guard isTracking else { return }
        let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        beginInterval(for: app)
    }

    private func beginInterval(for app: NSRunningApplication?) {
        flushCurrentInterval()

        let name = app?.localizedName ?? "Unknown"
        let bundleId = app?.bundleIdentifier
        currentAppName = name
        currentInterval = FocusInterval(appName: name, bundleId: bundleId, startedAt: Date())
    }

    private func flushCurrentInterval() {
        guard let interval = currentInterval else { return }
        let endedAt = Date()
        if let event = EventBuilder.makeEvent(from: interval, endedAt: endedAt) {
            onIntervalCompleted?(event)
        }
        currentInterval = nil
    }

    private func startFlushTimer() {
        flushTimer?.invalidate()
        flushTimer = Timer.scheduledTimer(withTimeInterval: flushIntervalSec, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.flushPartialInterval()
            }
        }
    }

    /// Posts the elapsed portion of the current interval and starts a fresh one for the same app.
    private func flushPartialInterval() {
        guard isTracking, let interval = currentInterval else { return }
        let endedAt = Date()
        if let event = EventBuilder.makeEvent(from: interval, endedAt: endedAt) {
            onIntervalCompleted?(event)
        }
        currentInterval = FocusInterval(
            appName: interval.appName,
            bundleId: interval.bundleId,
            startedAt: endedAt
        )
    }
}
