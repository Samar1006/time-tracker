import Foundation

enum EventBuilder {
    static let minimumDurationSec = 1

    static func makeEvent(
        from interval: FocusInterval,
        endedAt: Date = Date(),
        title: String? = nil
    ) -> ActivityEvent? {
        let durationSec = Int(interval.elapsed(until: endedAt).rounded())
        guard durationSec >= minimumDurationSec else { return nil }

        var metadata: [String: String] = [
            "sourceClient": "mac-tracker",
            "localDate": localDateString(from: interval.startedAt),
        ]
        if let bundleId = interval.bundleId {
            metadata["bundleId"] = bundleId
        }

        return ActivityEvent(
            timestamp: iso8601UTC(interval.startedAt),
            type: "app_focus",
            app: interval.appName,
            title: title,
            durationSec: durationSec,
            metadata: metadata
        )
    }

    static func iso8601UTC(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func localDateString(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar.current
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
