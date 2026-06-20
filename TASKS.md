# Tasks

> **Foreman rule:** Update status, owners, blockers, and next steps here when you start or finish work. If unsure, add a **Question** instead of guessing.

**Last foreman check:** 2026-06-20

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
| `main` | — | — | — | 🟢 Protected | Integration target |
| `ai-pipeline` | Allisonmini | **+1** / 0 | [#1](https://github.com/Samar1006/time-tracker/pull/1) open, **mergeable** | 🟢 Ready | PR review agent → merge |
| `dj` | Frontend | **+1** / **−5** | none | 🟡 Stale | **Rebase onto `main`** before next PR |
| `ingestion-timeline` | Samar | 0 / **−2** | merged ([#2](https://github.com/Samar1006/time-tracker/pull/2)) | ⚪ Done | Safe to delete |

### Merge order (do not reorder)

```
1. ai-pipeline  → main   (backend complete; PR #1 ready)
2. dj           → main   (after rebase; adds Angular app under frontend/time-tracker-app/)
3. categoryHint → categorizationService swap (small follow-up on main)
```

---

## MVP progress

| # | Priority | Task | Owner | Status | Branch |
|---|----------|------|-------|--------|--------|
| 1 | P0 | `POST /api/events` + Redis | Samar | ✅ Merged | `main` |
| 2 | P0 | `GET /api/timeline` hour buckets | Samar | ✅ Merged | `main` |
| 3 | P0 | Demo seed + fallback JSON | Samar | ✅ Merged | `main` |
| 4 | P0 | Schedule parse + categorization | Allisonmini | 🟡 PR #1 ready | `ai-pipeline` |
| 5 | P0 | `POST /api/transcribe` | Allisonmini | 🟡 On PR branch | `ai-pipeline` |
| 6 | P1 | Frontend auth shell | Frontend | 🟡 On `dj`, needs rebase | `dj` |
| 7 | P1 | Timeline bar chart UI | Frontend | 🔲 Not started | `dj` |
| 8 | P1 | Swap `categoryHint` → `categorizationService` | Samar / Allison | 🔲 After #4 merges | `main` |
| 9 | P2 | Native mac/iOS/browser capture | TBD | 🔲 Not started | — |

---

## Samar — ingestion (merged)

**Status:** ✅ On `main`. Branch `ingestion-timeline` can be deleted.

**Standby:** After `ai-pipeline` merges, replace `categoryHint.js` imports in `aggregationService.js` with `categorizationService.js`.

---

## Allisonmini — AI & voice (`ai-pipeline`)

**Status:** Rebased onto `main`. PR #1 is **mergeable** (no conflicts).

**On branch (not yet on `main`):**
- Integrated `app.js` — both activity + schedule routers
- `POST /api/transcribe` — JSON `{ url }` or `{ audioBase64 }`
- `POST /api/schedule/parse`, `POST /api/categorize/*`
- Claude (`ANTHROPIC_API_KEY`) for optional LLM refinement

**Contract note for review agent:** `/api/transcribe` uses JSON base64, not multipart — update `API_CONTRACT.md` when PR merges.

**Blockers:** None — waiting on PR review agent merge.

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
| `dj` PR opened without rebase | 🔴 High | Will conflict on `frontend/`, miss server API |
| Two env var names for LLM | 🟡 Low | Contract still says `OPENAI_*`; branch uses `ANTHROPIC_API_KEY` — fix at AI merge |
| Stale `ingestion-timeline` branch | 🟢 Low | Delete to reduce confusion |

---

## Questions for the team

1. **Who owns `dj`?** Assign name in this table.
2. **Timeline UI timing:** start on rebased `dj` now, or wait for `ai-pipeline` merge?
3. **Delete `backend/.gitkeep`** and stale `ingestion-timeline` branch?
