import Foundation

struct FocusInterval: Equatable {
    let appName: String
    let bundleId: String?
    let startedAt: Date

    func elapsed(until end: Date = Date()) -> TimeInterval {
        max(0, end.timeIntervalSince(startedAt))
    }
}
