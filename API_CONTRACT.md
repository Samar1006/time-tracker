# API Contract

> **Foreman rule:** Do not change routes, request/response shapes, env vars, or Redis key patterns without updating this file and `TASKS.md` in the same PR.

**Base URL (local):** `http://localhost:4000`  
**Content-Type:** `application/json` unless noted  
**Timestamps:** ISO 8601 UTC (`2026-06-20T14:30:00.000Z`) for stored events and timeline blocks. Voice-parsed schedule blocks may use 12-hour `H:MM AM/PM` when no calendar date is known — see [Schedule block](#schedule-block-voice--ai).

---

## Ownership

| Area | Owner | Branch (working) | Key files |
|------|-------|------------------|-----------|
| Ingestion, Redis storage, timeline aggregation | **Samar** | `main` (was `ingestion-timeline`) | `server/src/routes/activity.js`, `server/src/services/redisClient.js`, aggregation logic |
| AI & voice pipeline | **Allisonmini** | `ai-pipeline` | `server/src/services/deepgramService.js`, `server/src/routes/schedule.js`, `server/src/services/categorizationService.js` |
| Frontend | **Frontend team** | `dj` | `frontend/time-tracker-app/` (Angular 21) |

Both backend slices share one Express app under `server/`. Coordinate `server/package.json` and `server/src/app.js` router wiring via small PRs to `main`.

---

## Environment variables

Documented in `server/.env.example`. Never commit real `.env`.

| Variable | Required | Owner | Purpose |
|----------|----------|-------|---------|
| `PORT` | No (default `4000`) | shared | HTTP port |
| `REDIS_URL` | No | Samar | Raw event storage; in-memory fallback when unset |
| `DEEPGRAM_API_KEY` | For live STT only | Allisonmini | Speech-to-text |
| `ANTHROPIC_API_KEY` | No | Allisonmini | Optional Claude schedule refinement (on `ai-pipeline`) |
| `GOOGLE_CLIENT_ID` | For Google login | Frontend/backend | OAuth web client ID; backend validates Google credentials against this audience, frontend uses the same ID when rendering the Google Sign-In button |

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
| `userId` | No | Ignored; server sets from JWT. If present and ≠ token user → `403` |
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

Output of transcript parsing. Times are **local wall-clock** 12-hour labels with AM/PM. Each block includes a calendar **`date`** (`YYYY-MM-DD`) for when the block **starts**; spoken cues like “today”, “tomorrow”, or “Monday” set the date. When a block spans past midnight (e.g. sleep from 8:00 PM to 6:00 AM), include optional **`endDate`** (`YYYY-MM-DD`) for the morning end; omit `endDate` when start and end are on the same day.

```json
{
  "date": "2026-06-20",
  "dayLabel": "today",
  "start": "8:00 PM",
  "end": "6:00 AM",
  "endDate": "2026-06-21",
  "durationMin": 600,
  "activity": "sleeping",
  "category": "break",
  "confidence": 0.6,
  "raw": "I will sleep from 8 pm to 6 am"
}
```

Optional request field: `referenceDate` (ISO 8601) — anchor for resolving “today” / “tomorrow” (defaults to server now).

---

## Endpoints

### Health

#### `GET /health`

**Status:** ✅ Implemented on `ingestion-timeline`  
**Response:** `{ "ok": true }`

---

### Auth (login & sessions)

#### `POST /api/auth/login`

**Status:** ✅ Implemented on `auth-backend`  
**Request:** `{ "email", "password" }`  
**Success:** `200` — `{ "token", "user": { "id", "email", "fullName" } }`  
**Errors:** `400`, `401`

#### `POST /api/auth/signup`

**Status:** ✅ Implemented on `auth-backend`  
**Request:** `{ "fullName", "email", "password" }` (password min 8 chars)  
**Success:** `201` — `{ "token", "user" }`  
**Errors:** `400`, `409` (email taken)

#### `POST /api/auth/google`

**Status:** ✅ Implemented on `nikki`  
**Request:** `{ "credential" }` where `credential` is the Google Identity Services ID token  
**Success:** `200` — `{ "token", "user": { "id", "email", "fullName" } }`  
**Errors:** `400` (missing credential), `401` (invalid Google credential), `500` (missing `GOOGLE_CLIENT_ID`)

#### `GET /api/auth/me`

**Status:** ✅ Implemented on `auth-backend`  
**Headers:** `Authorization: Bearer <token>`  
**Success:** `200` — `{ "user": { "id", "email", "fullName" } }`

#### `GET /api/auth/demo-account`

**Status:** ✅ Implemented on `auth-backend`  
**Success:** `200` — seeded test credentials for local demo

**Demo user (seeded on server start):**

| Field | Value |
|-------|-------|
| Email | `demo@timetracker.test` |
| Password | `Demo1234!` |
| User ID | `user-demo-1` |

**Env:** `JWT_SECRET` (optional; dev default if unset)

---

#### `POST /api/events`

**Status:** ✅ Implemented on `ingestion-timeline`  
**Owner:** Samar

**Headers:** `Authorization: Bearer <token>` (required)

**Request body:** single [Raw activity event](#raw-activity-event) or `{ "events": [ ... ] }` for batch. `userId` in the body is optional; the server always stores events under the authenticated user's id.

**Success:** `201`

```json
{
  "accepted": 1,
  "ids": ["evt_abc123"],
  "storage": "memory"
}
```

**Errors:** `401` (missing/invalid token), `403` (body `userId` ≠ token user), `400` (missing fields), `503` (Redis unavailable when `REDIS_URL` set but down)

**Redis key:** `events:{userId}:{YYYY-MM-DD}` — list of JSON strings

**Example:**

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@timetracker.test","password":"Demo1234!"}' | jq -r .token)
curl -s -X POST http://localhost:4000/api/events \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"timestamp":"2026-06-20T14:00:00.000Z","type":"app_focus","app":"Cursor","durationSec":300}'
```

---

#### `GET /api/timeline`

**Status:** ✅ Implemented on `ingestion-timeline`  
**Owner:** Samar

**Headers:** `Authorization: Bearer <token>` (required)

**Query params:**

| Param | Required | Default |
|-------|----------|---------|
| `userId` | No | authenticated user (if provided, must match token user or `403`) |
| `date` | No | today (UTC) |
| `timezone` | No | `UTC` |

**Success:** `200` — [Timeline hour bucket](#timeline-hour-bucket) object (24 slots).

**Errors:** `401` (missing/invalid token), `403` (`userId` query ≠ token user)

**Demo fallback:** Returns padded `demoTimeline.json` when no stored events exist.

---

#### Dev helpers (Samar — not required for MVP judges)

All require `Authorization: Bearer <token>`. Scoped to the authenticated user only.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/events/seed` | Load mock events for demo user |
| GET | `/api/events` | Debug raw stored events |
| DELETE | `/api/events` | Clear authenticated user's day |

---

### Speech-to-text (Allisonmini)

#### `POST /api/transcribe`

**Status:** 🟡 On `ai-pipeline` PR #1 (not merged)  
**Owner:** Allisonmini

**Request:** JSON `{ "url": "https://..." }` **or** `{ "audioBase64": "..." }`.

**Success:** `200` — `{ "transcript", "words": [...] }`  
**Errors:** `400` (no input), `502` (Deepgram error)

---

### Schedule parsing (Allisonmini)

#### `POST /api/schedule/parse`

**Status:** 🟡 On `ai-pipeline` PR #1 (not merged)  
**Request:** `{ "transcript", "useLLM?": false, "referenceDate?": "2026-06-20T00:00:00.000Z", "categoryContext?": [{ "label", "description" }] }`  

Optional **`categoryContext`** (request-only, not stored): user-defined groupings passed to Claude when `useLLM` is true. Each item has a short `label` and `description`; the model maps them to the [Category enum](#category-enum) (`work`, `communication`, etc.). Heuristic parsing ignores this field.

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
2. ✅ `POST /api/events` + Redis write (Samar — `ingestion-timeline`)
3. ✅ `GET /api/timeline` + hour bucketing (Samar — `ingestion-timeline`)
4. 🟡 `POST /api/transcribe` — on `ai-pipeline` PR #1
5. 🟡 `POST /api/schedule/parse` + categorize — on `ai-pipeline` PR #1
6. 🔲 Frontend timeline bar chart (`dj` branch — rebase needed)
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
