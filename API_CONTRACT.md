# API Contract

> **Foreman rule:** Do not change routes, request/response shapes, env vars, or Redis key patterns without updating this file and `TASKS.md` in the same PR.

**Base URL (local):** `http://localhost:4000`  
**Content-Type:** `application/json` unless noted  
**Timestamps:** ISO 8601 UTC (`2026-06-20T14:30:00.000Z`) for stored events and timeline blocks. Voice-parsed schedule blocks may use `HH:MM` (24h) when no calendar date is known — see [Schedule block](#schedule-block-voice--ai).

---

## Ownership

| Area | Owner | Branch (working) | Key files |
|------|-------|------------------|-----------|
| Ingestion, Redis storage, timeline aggregation | **Samar** | `samar` | `server/src/routes/activity.js`, `server/src/services/redisClient.js`, aggregation logic |
| AI & voice pipeline | **Allisonmini** | `ai-pipeline` | `server/src/services/deepgramService.js`, `server/src/routes/schedule.js`, `server/src/services/categorizationService.js` |
| Frontend | TBD | TBD | `frontend/` |

Both backend slices share one Express app under `server/`. Coordinate `server/package.json` and `server/src/app.js` router wiring via small PRs to `main`.

---

## Environment variables

Documented in `server/.env.example`. Never commit real `.env`.

| Variable | Required | Owner | Purpose |
|----------|----------|-------|---------|
| `PORT` | No (default `4000`) | shared | HTTP port |
| `REDIS_URL` | No | Samar | Raw event storage; in-memory fallback when unset |
| `DEEPGRAM_API_KEY` | For live STT only | Allisonmini | Speech-to-text |
| `OPENAI_API_KEY` | No | Allisonmini | Optional LLM schedule refinement |
| `OPENAI_MODEL` | No | Allisonmini | LLM model (default `gpt-4o-mini`) |

---

## Shared types

### Category enum

Used by categorization, schedule parsing, and timeline blocks:

`work` | `communication` | `learning` | `entertainment` | `break` | `uncategorized`

### Raw activity event

Posted by clients (browser extension, macOS/iOS tracker, demo script).

```json
{
  "userId": "user-demo-1",
  "timestamp": "2026-06-20T14:05:00.000Z",
  "type": "app_focus",
  "app": "Cursor",
  "domain": "github.com",
  "title": "time-tracker — activity.js",
  "durationSec": 120,
  "metadata": {}
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `userId` | **Yes** | Stable string per user/session |
| `timestamp` | **Yes** | ISO 8601 UTC — start of event |
| `type` | **Yes** | e.g. `app_focus`, `domain_visit`, `idle`, `manual` |
| `app` | No | Application name |
| `domain` | No | Normalized host when applicable |
| `title` | No | Window/tab title |
| `durationSec` | No | Length in seconds; defaults to 300s if omitted |
| `metadata` | No | Opaque bag for client-specific fields |

### Timeline hour bucket

Returned by `GET /api/timeline` for the hour-by-hour bar visualization.

```json
{
  "userId": "user-demo-1",
  "date": "2026-06-20",
  "timezone": "UTC",
  "totalTrackedSec": 15300,
  "hours": [
    {
      "hour": 9,
      "label": "09:00",
      "totalTrackedSec": 3600,
      "blocks": [
        {
          "start": "2026-06-20T09:00:00.000Z",
          "end": "2026-06-20T10:00:00.000Z",
          "activity": "Visual Studio Code",
          "category": "work",
          "source": "tracked",
          "confidence": 0.7,
          "durationSec": 3600
        }
      ]
    }
  ]
}
```

| Field | Notes |
|-------|-------|
| `source` | `tracked` \| `voice` \| `manual` \| `demo` |
| `category` | From [Category enum](#category-enum) |
| `confidence` | 0–1 |

### Schedule block (voice / AI)

Output of transcript parsing. Times are **local wall-clock** `HH:MM` when date is unknown.

```json
{
  "start": "09:00",
  "end": "10:30",
  "durationMin": 90,
  "activity": "worked on the dashboard",
  "category": "work",
  "confidence": 0.6,
  "raw": "From 9 to 10:30 I worked on the dashboard"
}
```

---

## Endpoints

### Health

#### `GET /health`

**Status:** ✅ Implemented on `samar`  
**Response:** `{ "ok": true }`

---

### Activity ingestion (Samar)

#### `POST /api/events`

**Status:** ✅ Implemented on `samar`  
**Owner:** Samar

**Request body:** single [Raw activity event](#raw-activity-event) or `{ "events": [ ... ] }` for batch.

**Success:** `201`

```json
{
  "accepted": 1,
  "ids": ["evt_abc123"],
  "storage": "memory"
}
```

**Errors:** `400` (missing fields), `503` (Redis unavailable when `REDIS_URL` set but down)

**Redis key:** `events:{userId}:{YYYY-MM-DD}` — list of JSON strings

---

#### `GET /api/timeline`

**Status:** ✅ Implemented on `samar`  
**Owner:** Samar

**Query params:**

| Param | Required | Default |
|-------|----------|---------|
| `userId` | **Yes** | — |
| `date` | No | today (UTC) |
| `timezone` | No | `UTC` |

**Success:** `200` — [Timeline hour bucket](#timeline-hour-bucket) object (24 slots).

**Demo fallback:** Returns padded `demoTimeline.json` when no stored events exist.

---

#### Dev helpers (Samar — not required for MVP judges)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/events/seed` | Load mock events for demo |
| GET | `/api/events` | Debug raw stored events |
| DELETE | `/api/events` | Clear a user/day |

---

### Speech-to-text (Allisonmini)

#### `POST /api/transcribe`

**Status:** 🔲 Not implemented — service exists, no route  
**Owner:** Allisonmini

**Request:** `multipart/form-data` with `audio` file **or** JSON `{ "url": "https://..." }`.

**Success:** `200` — `{ "transcript", "words": [...] }`

---

### Schedule parsing (Allisonmini)

#### `POST /api/schedule/parse`

**Status:** ✅ Implemented on `ai-pipeline` (not merged to `main`)  
**Request:** `{ "transcript", "useLLM?": false }`  
**Response:** `{ "blocks": [ Schedule block ] }`

---

### Categorization (Allisonmini)

#### `POST /api/categorize/domain`

**Status:** ✅ On `ai-pipeline`  
**Request:** `{ "domain": "github.com" }`

#### `POST /api/categorize/activity`

**Status:** ✅ On `ai-pipeline`  
**Request:** `{ "text": "debugging the api", "useVector": false }`

---

## MVP checklist (integration order)

1. ✅ Contract documented (this file)
2. ✅ `POST /api/events` + Redis write (Samar — `samar`)
3. ✅ `GET /api/timeline` + hour bucketing (Samar — `samar`)
4. 🔲 `POST /api/transcribe` route wired to Deepgram (Allisonmini)
5. ✅ `POST /api/schedule/parse` (on branch, needs merge)
6. 🔲 Frontend timeline bar chart against `/api/timeline`
7. 🔲 End-to-end demo: mock events **or** voice → transcript → blocks → display

---

## Error shape (standardize across routes)

```json
{ "error": "Human-readable message", "code": "OPTIONAL_MACHINE_CODE" }
```

---

## Integration merge plan (`app.js`)

After both branches merge, `createApp()` should mount:

```js
app.use('/api', activityRouter);           // Samar — /events, /timeline
app.use('/api/schedule', scheduleRouter);  // Allisonmini
// + categorize routes and /api/transcribe
```

Single `/health` should report `{ ok: true }`.
