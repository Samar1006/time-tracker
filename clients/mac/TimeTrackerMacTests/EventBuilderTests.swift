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
        XCTAssertEqual(event?.metadata?["localDate"], EventBuilder.localDateString(from: start))
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

final class BrowserFilterTests: XCTestCase {
    func testSkipsKnownBrowsersByBundleId() {
        XCTAssertTrue(BrowserFilter.shouldSkip(bundleId: "com.brave.Browser", appName: "Brave Browser"))
        XCTAssertTrue(BrowserFilter.shouldSkip(bundleId: "com.google.Chrome", appName: "Google Chrome"))
        XCTAssertTrue(BrowserFilter.shouldSkip(bundleId: "com.apple.Safari", appName: "Safari"))
    }

    func testSkipsKnownBrowsersByAppNameWhenBundleIdMissing() {
        XCTAssertTrue(BrowserFilter.shouldSkip(bundleId: nil, appName: "Brave Browser"))
        XCTAssertTrue(BrowserFilter.shouldSkip(bundleId: nil, appName: "Google Chrome"))
    }

    func testDoesNotSkipNonBrowsers() {
        XCTAssertFalse(BrowserFilter.shouldSkip(bundleId: "com.todesktop.230313mzl4w4u92", appName: "Cursor"))
        XCTAssertFalse(BrowserFilter.shouldSkip(bundleId: "md.obsidian", appName: "Obsidian"))
        XCTAssertFalse(BrowserFilter.shouldSkip(bundleId: nil, appName: "Slack"))
    }
}

final class SystemAppFilterTests: XCTestCase {
    func testSkipsLoginWindow() {
        XCTAssertTrue(SystemAppFilter.shouldSkip(bundleId: "com.apple.loginwindow", appName: "loginwindow"))
        XCTAssertTrue(SystemAppFilter.shouldSkip(bundleId: nil, appName: "loginwindow"))
    }

    func testDoesNotSkipRegularApps() {
        XCTAssertFalse(SystemAppFilter.shouldSkip(bundleId: "com.todesktop.230313mzl4w4u92", appName: "Cursor"))
        XCTAssertFalse(SystemAppFilter.shouldSkip(bundleId: nil, appName: "Slack"))
    }
}
