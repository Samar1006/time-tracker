import AppKit
import Foundation

@MainActor
final class AppFocusTracker: ObservableObject {
    @Published private(set) var currentAppName: String = "—"
    @Published private(set) var isTracking = false

    var onIntervalCompleted: ((ActivityEvent) -> Void)?

    private var currentInterval: FocusInterval?
    private var workspaceObserver: NSObjectProtocol?
    private var sleepObserver: NSObjectProtocol?
    private var wakeObserver: NSObjectProtocol?
    private var flushTimer: Timer?
    private let flushIntervalSec: TimeInterval
    private var isPausedForSleep = false

    init(flushIntervalSec: TimeInterval = 60) {
        self.flushIntervalSec = flushIntervalSec
    }

    func start() {
        guard !isTracking else { return }
        isTracking = true
        isPausedForSleep = false

        let center = NSWorkspace.shared.notificationCenter

        workspaceObserver = center.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            Task { @MainActor in
                self?.handleActivation(notification)
            }
        }

        sleepObserver = center.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleWillSleep()
            }
        }

        wakeObserver = center.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleDidWake()
            }
        }

        beginInterval(for: NSWorkspace.shared.frontmostApplication)
        startFlushTimer()
    }

    func stop() {
        guard isTracking else { return }
        flushCurrentInterval()
        isTracking = false
        isPausedForSleep = false

        let center = NSWorkspace.shared.notificationCenter
        for observer in [workspaceObserver, sleepObserver, wakeObserver].compactMap({ $0 }) {
            center.removeObserver(observer)
        }
        workspaceObserver = nil
        sleepObserver = nil
        wakeObserver = nil

        flushTimer?.invalidate()
        flushTimer = nil
        currentInterval = nil
        currentAppName = "—"
    }

    private func handleActivation(_ notification: Notification) {
        guard isTracking, !isPausedForSleep else { return }
        let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        beginInterval(for: app)
    }

    private func handleWillSleep() {
        guard isTracking, !isPausedForSleep else { return }
        isPausedForSleep = true
        flushCurrentInterval(endedAt: Date())
        flushTimer?.invalidate()
        flushTimer = nil
        currentInterval = nil
        currentAppName = "Sleeping"
    }

    private func handleDidWake() {
        guard isTracking, isPausedForSleep else { return }
        isPausedForSleep = false
        beginInterval(for: NSWorkspace.shared.frontmostApplication)
        startFlushTimer()
    }

    private func beginInterval(for app: NSRunningApplication?) {
        flushCurrentInterval()

        let name = app?.localizedName ?? "Unknown"
        let bundleId = app?.bundleIdentifier

        if shouldSkip(bundleId: bundleId, appName: name) {
            currentAppName = skippedAppLabel(name)
            currentInterval = nil
            return
        }

        currentAppName = name
        currentInterval = FocusInterval(appName: name, bundleId: bundleId, startedAt: Date())
    }

    private func flushCurrentInterval(endedAt: Date = Date()) {
        guard let interval = currentInterval else { return }
        currentInterval = nil

        if shouldSkip(bundleId: interval.bundleId, appName: interval.appName) {
            return
        }

        if let event = EventBuilder.makeEvent(from: interval, endedAt: endedAt) {
            onIntervalCompleted?(event)
        }
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
        guard isTracking, !isPausedForSleep, let interval = currentInterval else { return }
        if shouldSkip(bundleId: interval.bundleId, appName: interval.appName) {
            currentInterval = nil
            return
        }

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

    private func shouldSkip(bundleId: String?, appName: String) -> Bool {
        BrowserFilter.shouldSkip(bundleId: bundleId, appName: appName)
            || SystemAppFilter.shouldSkip(bundleId: bundleId, appName: appName)
    }

    private func skippedAppLabel(_ name: String) -> String {
        if BrowserFilter.shouldSkip(bundleId: nil, appName: name) {
            return "\(name) (extension)"
        }
        return "\(name) (ignored)"
    }
}
