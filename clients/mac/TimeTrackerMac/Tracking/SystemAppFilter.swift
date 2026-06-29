import Foundation

/// System UI that should never be logged as user activity.
enum SystemAppFilter {
    private static let bundleIds: Set<String> = [
        "com.apple.loginwindow",
        "com.apple.WindowServer",
        "com.apple.ScreenSaver.Engine",
    ]

    private static let appNames: Set<String> = [
        "loginwindow",
        "windowserver",
        "screensaver engine",
    ]

    static func shouldSkip(bundleId: String?, appName: String) -> Bool {
        if let bundleId, !bundleId.isEmpty, bundleIds.contains(bundleId) {
            return true
        }

        let normalized = appName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return appNames.contains(normalized)
    }
}
