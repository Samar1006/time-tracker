import Foundation

/// Browsers tracked by the Chrome extension (domain-level). The Mac app skips these to avoid duplicate blocks.
enum BrowserFilter {
    private static let bundleIdPrefixes = [
        "com.apple.Safari",
        "com.google.Chrome",
        "com.brave.Browser",
        "org.mozilla.firefox",
        "com.microsoft.edgemac",
        "company.thebrowser.Browser",
        "com.operasoftware.Opera",
        "com.vivaldi.Vivaldi",
        "org.chromium.Chromium",
    ]

    private static let appNames: Set<String> = [
        "safari",
        "google chrome",
        "chrome",
        "brave browser",
        "brave",
        "firefox",
        "microsoft edge",
        "edge",
        "arc",
        "opera",
        "vivaldi",
        "chromium",
    ]

    static func shouldSkip(bundleId: String?, appName: String) -> Bool {
        if let bundleId, !bundleId.isEmpty {
            for prefix in bundleIdPrefixes where bundleId == prefix || bundleId.hasPrefix("\(prefix).") {
                return true
            }
        }

        let normalized = appName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return appNames.contains(normalized)
    }
}
