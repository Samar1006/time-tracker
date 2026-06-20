# time-tracker — server (activity ingestion & aggregation)

Backend slice owned by Samar: ingest raw mac/ios/manual usage events into Redis
(or in-memory fallback), and aggregate them into hour-by-hour blocks for the
frontend bar chart.

Aligned with `API_CONTRACT.md` (foreman).

## Setup

```bash
cd server
npm install
cp .env.example .env   # REDIS_URL optional for local demo/tests
```

## Run

```bash
npm run dev     # http://localhost:4000
npm start
```

## Test

Uses the built-in Node test runner — **no Redis required**.

```bash
npm test
```

## Quick demo

```bash
npm run dev
curl -X POST http://localhost:4000/api/events/seed \
  -H 'Content-Type: application/json' \
  -d '{"userId":"user-demo-1","date":"2026-06-20"}'
curl "http://localhost:4000/api/timeline?userId=user-demo-1&date=2026-06-20"
```

## Contract endpoints (Samar-owned)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/events` | Single event or `{ events: [...] }` |
| GET | `/api/timeline` | Requires `userId`; demo JSON fallback when empty |
| POST | `/api/events/seed` | Dev helper — loads mock events |
| GET | `/api/events` | Debug raw events |
| DELETE | `/api/events` | Clear a user/day |

See `../API_CONTRACT.md` for full request/response shapes.

## Files

- `src/services/redisClient.js` — Redis list helpers + in-memory fallback
- `src/services/activityStore.js` — `events:{userId}:{YYYY-MM-DD}` keys
- `src/services/aggregationService.js` — hour bucketing for timeline
- `src/services/categoryHint.js` — lightweight categories until AI slice merges
- `src/routes/activity.js` — REST handlers
- `src/data/sampleActivityEvents.js` — mocked tracker events
- `src/data/demoTimeline.json` — static fallback for frontend dev

## Merge notes

- Branch: `ingestion-timeline` (do not edit `ai-pipeline` / Allisonmini files).
- When merging with `ai-pipeline`, combine `app.js` routers and reconcile
  `package.json`. Swap `categoryHint.js` for `categorizationService.js` imports.
