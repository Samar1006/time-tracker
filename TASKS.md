# Tasks

> **Foreman rule:** Update status, owners, blockers, and next steps here when you start or finish work. If unsure, add a **Question** instead of guessing.

**Last foreman check:** 2026-06-20 — PR #2 merged to `main`

---

## MVP progress

| # | Priority | Task | Owner | Status | Branch |
|---|----------|------|-------|--------|--------|
| 1 | P0 | `POST /api/events` stores raw events in Redis | Samar | ✅ Merged | `main` |
| 2 | P0 | Redis client + `events:{userId}:{date}` schema | Samar | ✅ Merged | `main` |
| 3 | P0 | `GET /api/timeline` hour-by-hour blocks | Samar | ✅ Merged | `main` |
| 4 | P0 | Demo timeline fallback + mock seed | Samar | ✅ Merged | `main` |
| 5 | P0 | PR ingestion slice → `main` | Samar | ✅ Merged ([#2](https://github.com/Samar1006/time-tracker/pull/2)) | — |
| 6 | P0 | PR Allison slice → `main` | Allisonmini | 🟡 Ready (rebase needed) | `ai-pipeline` |
| 7 | P0 | Merge `app.js` + `package.json` without conflicts | Allisonmini / Foreman | 🟡 In progress | `ai-pipeline` |
| 8 | P0 | `POST /api/transcribe` HTTP route | Allisonmini | 🔲 Not started | `ai-pipeline` |
| 9 | P1 | Swap `categoryHint` → `categorizationService` | Allisonmini / Samar | 🔲 After #6 | — |
| 10 | P1 | Frontend timeline bar chart | TBD | 🔲 Not started | TBD |
| 11 | P2 | Native macOS/iOS/browser capture | TBD | 🔲 Not started | — |
| 12 | P2 | Redis vector categorization | Allisonmini | ⏸ Deferred | `ai-pipeline` |

**Legend:** 🔲 Not started · 🟡 In progress / ready · ✅ Done · ⏸ Deferred · 🚫 Blocked

---

## Samar — ingestion, storage & visualization

**Status:** ✅ Merged to `main` via PR #2

### Shipped

- `POST /api/events`, `GET /api/timeline`, dev helpers (`/events/seed`, etc.)
- Redis lists at `events:{userId}:{YYYY-MM-DD}` + in-memory fallback
- `demoTimeline.json` fallback when no stored events
- `categoryHint.js` (temporary until AI categorization merges)
- 10/10 tests passing

### Next steps (Samar)

1. Stand by for `ai-pipeline` rebase — help resolve `app.js` if needed.
2. After AI merge: replace `categoryHint` with `categorizationService` in aggregation.

---

## Allisonmini — AI & voice pipeline

**Branch:** `ai-pipeline` — **rebase onto `main` before opening PR**

### Done (on branch, not merged)

- `POST /api/schedule/parse`, `POST /api/categorize/*`
- `deepgramService.js` (library; no HTTP route yet)
- Offline tests pass with no API keys

### Next steps

1. **Rebase** `ai-pipeline` onto updated `main`.
2. Resolve conflicts in: `server/.env.example`, `server/.gitignore`, `server/README.md`, `server/package.json`, `server/src/app.js`.
3. Wire AI routes into `app.js` alongside existing `/api` activity router:

   ```js
   app.use('/api', activityRouter);      // Samar — keep
   app.use('/api/schedule', scheduleRouter);
   // + categorize routes + /api/transcribe
   ```

4. Add `POST /api/transcribe` per `API_CONTRACT.md`.
5. Open PR → `main`.

### Expected merge conflicts

| File | Resolution |
|------|------------|
| `.env.example` | Union both: `REDIS_URL` + `DEEPGRAM_API_KEY` + `OPENAI_*` |
| `package.json` | Union deps: add `@deepgram/sdk` to Samar's package |
| `app.js` | Mount both routers (see above) |
| `README.md` | Document both slices |

---

## Frontend

**Owner:** TBD

### Ready to build against `main`

```bash
cd server && npm install && npm run dev
curl "http://localhost:4000/api/timeline?userId=user-demo-1&date=2026-06-20"
curl -X POST http://localhost:4000/api/events/seed -H 'Content-Type: application/json' \
  -d '{"userId":"user-demo-1","date":"2026-06-20"}'
```

### Blockers

- `frontend/` is empty (`.gitkeep` only).
- Waiting on owner + stack.

---

## Integration queue

1. ~~**Samar:** PR `ingestion-timeline` → `main`~~ ✅ Done
2. **Allisonmini:** rebase `ai-pipeline` → resolve conflicts → add transcribe → PR
3. **Foreman:** review AI PR vs `API_CONTRACT.md`
4. **Frontend:** branch when ready

---

## Questions for the team

1. **Frontend owner & stack?** React/Vite, Next.js, other?
2. **Default timezone for timeline:** keep `UTC` for hackathon demo?
3. **Voice + tracked merge:** one chart or separate tabs for demo?
4. **Delete `backend/` folder** now that `server/` is on `main`?

---

## Blockers & risks

| Item | Severity | Notes |
|------|----------|-------|
| `ai-pipeline` needs rebase | 🟡 Medium | Conflicts in 5 shared files — predictable, not blocking |
| No `/api/transcribe` route | 🟡 Medium | Add before or in AI PR |
| Frontend unassigned | 🟡 Medium | Timeline API live on `main` — UI can start now |
