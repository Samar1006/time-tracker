import Foundation
import XCTest

// Tests compile against the TimeTrackerMac app module in Xcode.
@testable import TimeTrackerMac

final class EventBuilderTests: XCTestCase {
    func testMakeEventUsesIntervalStartAndDuration() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let end = start.addingTimeInterval(120)
        let interval = FocusInterval(appName: "Cursor", bundleId: "com.example.cursor", startedAt: start)

        let event = EventBuilder.makeEvent(from: interval, endedAt: end)

        XCTAssertEqual(event?.type, "app_focus")
        XCTAssertEqual(event?.app, "Cursor")
        XCTAssertEqual(event?.durationSec, 120)
        XCTAssertEqual(event?.metadata?["bundleId"], "com.example.cursor")
        XCTAssertEqual(event?.metadata?["sourceClient"], "mac-tracker")
        XCTAssertTrue(event?.timestamp.hasSuffix("Z") ?? false)
    }

    func testMakeEventReturnsNilForZeroDuration() {
        let start = Date()
        let interval = FocusInterval(appName: "Safari", bundleId: nil, startedAt: start)
        XCTAssertNil(EventBuilder.makeEvent(from: interval, endedAt: start))
    }

    func testIso8601UTCIncludesFractionalSeconds() {
        let date = Date(timeIntervalSince1970: 1_700_000_000.5)
        let formatted = EventBuilder.iso8601UTC(date)
        XCTAssertTrue(formatted.contains("."))
        XCTAssertTrue(formatted.hasSuffix("Z"))
    }
}
