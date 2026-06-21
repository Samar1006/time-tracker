# Client integration contract

Shared contract for native clients (Mac menu bar tracker, Chrome extension) posting activity to the time-tracker backend.

**Canonical API reference:** [`API_CONTRACT.md`](../API_CONTRACT.md) at repo root.

---

## Shared event shape

Each completed focus interval → one raw activity event:

```json
{
  "timestamp": "2026-06-21T15:00:00.000Z",
  "type": "app_focus",
  "app": "Cursor",
  "title": "optional window title",
  "durationSec": 120,
  "metadata": {
    "bundleId": "com.example.app",
    "sourceClient": "mac-tracker"
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `timestamp` | Yes | ISO 8601 UTC — interval **start** |
| `type` | Yes | `"app_focus"` for app/window focus |
| `app` | No | Application name |
| `title` | No | Window/tab title when available |
| `durationSec` | No | Seconds focused; server defaults to 300 if omitted |
| `metadata` | No | Client-specific fields (`bundleId`, `sourceClient`, etc.) |
| `userId` | **Do not send** | Server sets from JWT |

Batch ingest:

```json
{ "events": [ /* ... */ ] }
```

---

## Auth flow (all clients)

1. `POST /api/auth/login` with `{ "email", "password" }`
2. Response: `{ "token", "user": { "id", "email", "fullName" } }`
3. Store token securely (Mac: Keychain; Chrome: `chrome.storage.local` or similar)
4. Send `Authorization: Bearer <token>` on every ingest and timeline request

Demo account (local dev):

| Email | Password |
|-------|----------|
| `demo@timetracker.test` | `Demo1234!` |

---

## Mac tracker

- **Folder:** `clients/mac/`
- **Auth:** `POST /api/auth/login` → Bearer token in Keychain (service: `time-tracker`)
- **Ingest:** `POST /api/events` (no `userId` in body)
- **Event type:** `app_focus`
- **Capture:** `NSWorkspace.didActivateApplicationNotification` (not Screen Time)
- **Default API URL:** `http://127.0.0.1:4000`
- **Verify:** Log in at `:4200` dashboard, use Mac for 2 min, refresh timeline — blocks show `source: "tracked"`

---

## Chrome extension

- **Folder:** `clients/chrome-extension/` (Devarsh)
- **Auth:** Same login flow → store JWT
- **Ingest:** Same `POST /api/events` contract
- **Event types:** `app_focus` and/or `domain_visit` as applicable
- **Metadata:** `sourceClient: "chrome-extension"`

---

## Endpoints summary

| Step | Request |
|------|---------|
| Login | `POST http://127.0.0.1:4000/api/auth/login` |
| Ingest | `POST http://127.0.0.1:4000/api/events` + Bearer header |
| Timeline | `GET http://127.0.0.1:4000/api/timeline` + Bearer header |

---

## Verification checklist

1. Backend: `cd server && npm run dev` (:4000)
2. Frontend: `cd frontend/time-tracker-app && npm start` (:4200)
3. Client logs in with demo user
4. Generate activity (switch apps / browse tabs) for 2–3 minutes
5. Dashboard timeline shows new blocks with correct labels and `source: "tracked"`
