# Tasks

> **Foreman rule:** Update status, owners, blockers, and next steps here when you start or finish work. If unsure, add a **Question** instead of guessing.

**Last foreman check:** 2026-06-20 — `ai-pipeline` merged; `ingestion-timeline` deleted

---

## Foreman scope

| Foreman does | Foreman does **not** |
|--------------|----------------------|
| Track branch ahead/behind `main` | Review or approve PRs (→ **PR review agent**) |
| Keep `API_CONTRACT.md` / `TASKS.md` / `DECISIONS.md` current | Merge PRs |
| Flag merge conflicts & integration drift | Build features |
| Coordinate merge order | Overwrite teammates' in-progress work |

---

## Branch status (live)

| Branch | Owner | vs `main` | PR | Health | Action |
|--------|-------|-----------|-----|--------|--------|
| `main` | — | — | — | 🟢 Full backend (25 tests) | Integration target |
| `ai-pipeline` | Allisonmini | merged ([#1](https://github.com/Samar1006/time-tracker/pull/1)) | — | ⚪ Done | Deleted |
| `dj` | Frontend | **+1** / 0 | [#3](https://github.com/Samar1006/time-tracker/pull/3) open | 🟢 Ready | PR review agent reviewing |

### Merge order (do not reorder)

```
1. ~~ai-pipeline → main~~ ✅ Done (PR #1)
2. ~~dj → main~~ 🟡 PR [#3](https://github.com/Samar1006/time-tracker/pull/3) open (rebased, ready for review)
3. categoryHint → categorizationService swap (small follow-up on main)
```

---

## MVP progress

| # | Priority | Task | Owner | Status | Branch |
|---|----------|------|-------|--------|--------|
| 1 | P0 | `POST /api/events` + Redis | Samar | ✅ Merged | `main` |
| 2 | P0 | `GET /api/timeline` hour buckets | Samar | ✅ Merged | `main` |
| 3 | P0 | Demo seed + fallback JSON | Samar | ✅ Merged | `main` |
| 4 | P0 | Schedule parse + categorization | Allisonmini | ✅ Merged | `main` |
| 5 | P0 | `POST /api/transcribe` | Allisonmini | ✅ Merged | `main` |
| 6 | P1 | Frontend auth shell | Frontend | 🟡 PR #3 open | `dj` |
| 7 | P1 | Timeline bar chart UI | Frontend | 🔲 Not started | `dj` |
| 8 | P1 | Swap `categoryHint` → `categorizationService` | Samar / Allison | 🔲 After #4 merges | `main` |
| 9 | P2 | Native mac/iOS/browser capture | TBD | 🔲 Not started | — |

---

## Samar — ingestion (merged)

**Status:** ✅ On `main`. ~~Branch `ingestion-timeline`~~ deleted (merged via PR #2).

**Standby:** After `ai-pipeline` merges, replace `categoryHint.js` imports in `aggregationService.js` with `categorizationService.js`.

---

## Allisonmini — AI & voice (merged)

**Status:** ✅ Merged to `main` via PR #1. Branch `ai-pipeline` deleted.

**On `main`:** schedule parse, categorize, transcribe, integrated `app.js`.

---

## Frontend — Angular (`dj`)

**Status:** Rebased onto `main`. PR [#3](https://github.com/Samar1006/time-tracker/pull/3) open — PR review agent reviewing.

**On branch:** Login + signup pages, auth layout (Angular 21 under `frontend/time-tracker-app/`).  
**Not yet built:** Timeline bar chart wired to `GET /api/timeline`.

---

## Integration risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `dj` rebased before `ai-pipeline` merges | 🟢 Low | Frontend only needs `/api/timeline` (already on `main`) |
| `dj` rebased | 🟢 Done | PR #3 open, 0 commits behind `main` |
| `ai-pipeline` remote branch | 🟢 Done | Deleted |

---

## Questions for the team

1. **Who owns `dj`?** Assign name in this table.
2. **Timeline UI timing:** start on rebased `dj` now, or wait for `ai-pipeline` merge?
3. ~~**Delete `backend/.gitkeep`** and stale `ingestion-timeline` branch?~~ `ingestion-timeline` deleted.
