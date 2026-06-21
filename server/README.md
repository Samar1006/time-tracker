# time-tracker — server

Backend for the time-tracker app. Two slices live here:

- **Activity ingestion & timeline** (Samar) — ingest raw mac/iOS/manual usage
  events into Redis (or in-memory fallback), aggregate into hour-by-hour blocks.
- **AI & voice pipeline** (Allison) — speech-to-text, turning a transcript into
  structured schedule blocks, and auto-categorizing activity.

Request/response shapes are defined in the root [`API_CONTRACT.md`](../API_CONTRACT.md).

## Setup

```bash
cd server
npm install
cp .env.example .env   # all keys optional for local demo/tests
```

## Run

```bash
npm run dev     # http://localhost:4000
npm start
```

## Test

Built-in Node test runner — **no Redis and no API keys required**. Ingestion
uses the in-memory fallback; parsing and categorization run offline.

```bash
npm test
```

## Endpoints

| Method | Path | Owner | Notes |
|--------|------|-------|-------|
| GET  | `/health` | — | `{ ok: true }` |
| POST | `/api/events` | Samar | Single event or `{ events: [...] }` |
| GET  | `/api/timeline` | Samar | Requires `userId`; demo fallback when empty |
| POST | `/api/events/seed` | Samar | Dev helper — loads mock events |
| GET  | `/api/events` | Samar | Debug raw events |
| DELETE | `/api/events` | Samar | Clear a user/day |
| POST | `/api/schedule/parse` | Allison | `{ transcript, useLLM? }` → `{ blocks: [...] }` |
| POST | `/api/transcribe` | Allison | `{ url }` or `{ audioBase64 }` → `{ transcript, words }` (needs `DEEPGRAM_API_KEY`) |
| POST | `/api/categorize/domain` | Allison | `{ domain }` → `{ category, confidence, method }` |
| POST | `/api/categorize/activity` | Allison | `{ text, useVector? }` → `{ category, confidence, method }` |

### Schedule block shape
```json
{ "start": "09:00", "end": "10:30", "durationMin": 90,
  "activity": "worked on the dashboard", "category": "work",
  "confidence": 0.6, "raw": "From 9 to 10:30 I worked on the dashboard" }
```

## Files

Activity / timeline (Samar):
- `src/services/redisClient.js` — Redis list helpers + in-memory fallback
- `src/services/activityStore.js` — `events:{userId}:{YYYY-MM-DD}` keys
- `src/services/aggregationService.js` — hour bucketing for timeline
- `src/routes/activity.js` — REST handlers
- `src/data/sampleActivityEvents.js`, `src/data/demoTimeline.json` — mock data

AI / voice (Allison):
- `src/services/deepgramService.js` — Deepgram STT wrapper; pure `extractTranscript`/`extractWords` helpers
- `src/routes/schedule.js` — transcript → schedule blocks. Heuristic parser offline; optional Claude (`ANTHROPIC_API_KEY`) refinement via the Anthropic SDK
- `src/services/categorizationService.js` — keyword + domain categorization; optional Redis vector-similarity seam
- `src/data/sampleTranscripts.js` — sample transcripts + fake domains

## Keys

`DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, and `REDIS_URL` are all optional —
the server degrades to offline behavior when they're absent.

Timeline aggregation labels activities via the shared `categorizationService.js`
(the earlier `categoryHint.js` placeholder has been removed).
