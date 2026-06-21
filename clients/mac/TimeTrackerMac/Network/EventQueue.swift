import Foundation

@MainActor
final class EventQueue: ObservableObject {
    @Published private(set) var queuedCount = 0

    private var events: [ActivityEvent] = []

    func enqueue(_ event: ActivityEvent) {
        events.append(event)
        queuedCount = events.count
    }

    func enqueueAll(_ newEvents: [ActivityEvent]) {
        events.append(contentsOf: newEvents)
        queuedCount = events.count
    }

    func drain() -> [ActivityEvent] {
        let snapshot = events
        events.removeAll()
        queuedCount = 0
        return snapshot
    }

    var isEmpty: Bool { events.isEmpty }
}
