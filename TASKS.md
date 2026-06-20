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
| `ai-pipeline` | Allisonmini | merged ([#1](https://github.com/Samar1006/time-tracker/pull/1)) | — | ⚪ Done | Safe to delete remote branch |
| `dj` | Frontend | **+1** / **−7** | pending | 🟡 Stale | PR review agent next — **rebase onto `main` first** |

### Merge order (do not reorder)

```
1. ~~ai-pipeline → main~~ ✅ Done (PR #1)
2. dj           → main   (rebase first; PR review agent reviewing)
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
| 6 | P1 | Frontend auth shell | Frontend | 🟡 On `dj`, needs rebase | `dj` |
| 7 | P1 | Timeline bar chart UI | Frontend | 🔲 Not started | `dj` |
| 8 | P1 | Swap `categoryHint` → `categorizationService` | Samar / Allison | 🔲 After #4 merges | `main` |
| 9 | P2 | Native mac/iOS/browser capture | TBD | 🔲 Not started | — |

---

## Samar — ingestion (merged)

**Status:** ✅ On `main`. ~~Branch `ingestion-timeline`~~ deleted (merged via PR #2).

**Standby:** After `ai-pipeline` merges, replace `categoryHint.js` imports in `aggregationService.js` with `categorizationService.js`.

---

## Allisonmini — AI & voice (merged)

**Status:** ✅ Merged to `main` via PR #1. Remote branch `ai-pipeline` can be deleted.

**On `main`:** schedule parse, categorize, transcribe, integrated `app.js`.

---

## Frontend — Angular (`dj`)

**Owner:** Frontend team  
**App path:** `frontend/time-tracker-app/` (Angular 21)  
**Shipped on branch:** Login + signup pages, auth layout  
**Not yet built:** Timeline bar chart wired to `GET /api/timeline`

### Required before PR

1. **Rebase `dj` onto `main`** — currently 5 commits behind (missing entire activity API + foreman docs).
2. Confirm API base URL (suggest `http://localhost:4000` via environment config).
3. Build timeline view against contract shape in `API_CONTRACT.md`.

### Rebase command (for frontend owner)

```bash
git checkout dj
git fetch origin
git rebase origin/main
# resolve conflicts if any, then force-push with lease
git push --force-with-lease origin dj
```

---

## Integration risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `dj` rebased before `ai-pipeline` merges | 🟢 Low | Frontend only needs `/api/timeline` (already on `main`) |
| `dj` rebased before PR | 🔴 High | Still ~7 commits behind `main` |
| `ai-pipeline` remote branch | 🟢 Low | Merged — optional cleanup |

---

## Questions for the team

1. **Who owns `dj`?** Assign name in this table.
2. **Timeline UI timing:** start on rebased `dj` now, or wait for `ai-pipeline` merge?
3. ~~**Delete `backend/.gitkeep`** and stale `ingestion-timeline` branch?~~ `ingestion-timeline` deleted.
