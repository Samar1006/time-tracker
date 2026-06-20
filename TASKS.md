# Tasks

> **Foreman rule:** Update status, owners, blockers, and next steps here when you start or finish work. If unsure, add a **Question** instead of guessing.

**Last foreman check:** 2026-06-20 (Samar — aligned to `API_CONTRACT.md` routes)

---

## MVP progress

| # | Priority | Task | Owner | Status | Branch |
|---|----------|------|-------|--------|--------|
| 1 | P0 | `POST /api/events` stores raw events in Redis | Samar | ✅ Done locally | `samar` |
| 2 | P0 | Redis client + `events:{userId}:{date}` schema | Samar | ✅ Done locally | `samar` |
| 3 | P0 | `GET /api/timeline` hour-by-hour blocks | Samar | ✅ Done locally | `samar` |
| 4 | P0 | Demo timeline fallback + mock seed | Samar | ✅ Done locally | `samar` |
| 5 | P0 | Commit & PR Samar slice → `main` | Samar | 🟡 Ready | `samar` |
| 6 | P0 | PR Allison slice → `main` | Allisonmini | 🟡 Ready | `ai-pipeline` |
| 7 | P0 | Merge `app.js` + `package.json` without conflicts | Foreman / shared | 🔲 Blocked on PRs | — |
| 8 | P0 | `POST /api/transcribe` HTTP route | Allisonmini | 🔲 Not started | `ai-pipeline` |
| 9 | P1 | Frontend timeline bar chart | TBD | 🔲 Not started | TBD |
| 10 | P2 | Native macOS/iOS/browser capture | TBD | 🔲 Not started | — |
| 11 | P2 | Redis vector categorization | Allisonmini | ⏸ Deferred | `ai-pipeline` |

**Legend:** 🔲 Not started · 🟡 In progress / ready · ✅ Done · ⏸ Deferred · 🚫 Blocked

---

## Samar — ingestion, storage & visualization

**Branch:** `samar` (local, uncommitted)

### Done (local, not pushed)

- `POST /api/events` — contract raw event shape (`timestamp`, `type`, `durationSec`, …)
- `GET /api/timeline` — 24 hour buckets with categories + `demoTimeline.json` fallback
- `redisClient.js` — Redis lists + in-memory fallback
- `activityStore.js` — `events:{userId}:{YYYY-MM-DD}` keys
- `aggregationService.js` + `categoryHint.js`
- `POST /api/events/seed` — loads mock mac/ios/domain events
- Tests: `npm test` (all passing)

### Next steps

1. Commit and push `samar` branch.
2. Open PR → `main` (Samar files only — do not touch `ai-pipeline`).
3. After Allison PR merges, combine `app.js` routers; swap `categoryHint` → `categorizationService`.

### Blockers

- Work uncommitted until pushed.
- `app.js` / `package.json` conflict with `ai-pipeline` at merge time.

---

## Allisonmini — AI & voice pipeline

**Branch:** `origin/ai-pipeline` (1 commit ahead of `main`)

### Done (on branch, not merged)

- `POST /api/schedule/parse`, `POST /api/categorize/*`
- `deepgramService.js` (library; no HTTP route yet)
- Offline tests pass with no API keys

### Next steps

1. Add `POST /api/transcribe` per `API_CONTRACT.md`.
2. Open PR → `main`.
3. Rebase onto merged Samar PR if needed for `app.js`.

### Blockers

- Merge conflict risk on `app.js`, `package.json`, `.env.example`, `README.md`.

---

## Frontend

**Owner:** TBD

### Next steps

1. Confirm stack — see Questions.
2. Target `GET /api/timeline?userId=user-demo-1&date=2026-06-20` (works with demo fallback before seed).
3. Optional: `POST /api/events/seed` to load tracked mock data.

### Blockers

- `frontend/` is empty (`.gitkeep` only).

---

## Integration queue (recommended merge order)

1. **Samar:** commit → push → PR `samar` → `main`
2. **Allisonmini:** rebase `ai-pipeline` → add transcribe → PR
3. **Foreman:** verify combined routes vs `API_CONTRACT.md`
4. **Frontend:** branch when ready

---

## Questions for the team

1. **Frontend owner & stack?** React/Vite, Next.js, other?
2. **Default timezone for timeline:** keep `UTC` for hackathon demo?
3. **Voice + tracked merge:** one chart or separate tabs for demo?
4. **Delete `backend/` folder** on first server merge? (ADR-001 says use `server/` only.)

---

## Blockers & risks

| Item | Severity | Notes |
|------|----------|-------|
| Samar work uncommitted | 🔴 High | Push `samar` so teammates can build |
| Two parallel `server/` scaffolds | 🟡 Medium | `app.js` / `package.json` conflict at merge |
| No `/api/transcribe` route | 🟡 Medium | Blocks live voice demo |
| Frontend unassigned | 🟡 Medium | Demo timeline API ready for UI spike |
