# macOS menu bar activity tracker

Native macOS menu bar app that tracks the frontmost application via `NSWorkspace` and POSTs `app_focus` events to the time-tracker backend.

## Requirements

- macOS 13+
- Xcode 15+ (full Xcode, not Command Line Tools only)
- Backend running at `http://127.0.0.1:4000`
- Angular dashboard at `http://localhost:4200` (optional, for viewing timeline)

## Build and run

1. Open the Xcode project:

   ```bash
   open clients/mac/TimeTrackerMac.xcodeproj
   ```

2. Select the **TimeTrackerMac** scheme and press **Run** (⌘R).

3. The app appears in the menu bar as a clock icon. It has no Dock icon (`LSUIElement`).

## First-time setup

1. Start the backend:

   ```bash
   cd server && npm run dev
   ```

2. Start the frontend (for dashboard):

   ```bash
   cd frontend/time-tracker-app && npm start
   ```

3. Click the menu bar icon → **Log in…**

4. Sign in with the demo account:

   | Field | Value |
   |-------|-------|
   | Email | `demo@timetracker.test` |
   | Password | `Demo1234!` |

5. Switch between apps (Cursor, Safari, Slack) for 2–3 minutes.

6. Open the dashboard via **Open dashboard** in the menu, or visit http://localhost:4200/dashboard, and refresh. Timeline blocks should show real Mac app names with `source: "tracked"`.

## Menu actions

| Item | Description |
|------|-------------|
| Status line | Current app name when tracking |
| Connection | `Connected` or `Offline (N queued)` |
| Pause / Resume | Stop or restart focus tracking |
| Log in / Log out | JWT session via backend login |
| Open dashboard | Opens http://localhost:4200/dashboard in your browser |
| Quit | Exit the app |

## Configuration

Open **Time Tracker → Settings…** (macOS Settings app) to change the API base URL. Default is `http://127.0.0.1:4000`.

JWT tokens are stored in the Keychain (service: `time-tracker`, account: user email).

## How tracking works

- Subscribes to `NSWorkspace.didActivateApplicationNotification`
- On app switch: closes the previous focus interval and starts a new one
- Every 60 seconds: flushes the current interval (so long sessions are posted without waiting for a switch)
- Each completed interval becomes one `app_focus` event with `durationSec`
- Events are batch-posted to `POST /api/events` with `Authorization: Bearer <token>`
- No `userId` in the request body — the server derives it from the JWT

## Tests

In Xcode: **Product → Test** (⌘U) runs `EventBuilderTests` (interval → JSON payload).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Login fails | Confirm backend is running on port 4000 (`curl http://127.0.0.1:4000/health`) |
| Timeline shows only demo data | Refresh after tracking; ensure you logged in with the same demo user in the browser |
| `Offline (N queued)` | Backend unreachable; events queue in memory and retry every 30s |
| App Transport Security error | Info.plist allows local networking; use `127.0.0.1` not `localhost` for API if issues persist |
| No menu bar icon | Check menu bar overflow (notch Macs); app runs as agent with no Dock icon |

## Project layout

```
clients/mac/
  TimeTrackerMac.xcodeproj
  TimeTrackerMac/
    TimeTrackerMacApp.swift      # Menu bar entry point
    App/                         # AppState, menu UI
    Auth/                        # Login, Keychain
    Models/                      # API types
    Network/                     # APIClient, offline queue
    Tracking/                    # NSWorkspace observer, EventBuilder
  TimeTrackerMacTests/
    EventBuilderTests.swift
```

## Follow-up

The `mac-app-shell` task will embed the Angular dashboard in a WebView. This tracker keeps running independently in the menu bar.
