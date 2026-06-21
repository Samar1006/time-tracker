# Tasks

> **All agents:** Read this file and [`API_CONTRACT.md`](API_CONTRACT.md) before starting work. Update your task status when you finish.

**Last foreman check:** 2026-06-21 — PR #5 merged; `dj` = frontend integration branch

---

## Team delegation (current sprint)

### Frontend team — **`dj` branch** (frontend integration)

> **`dj` is the active frontend branch** — not stale. Rebase onto `main` before opening PR.

**Branch:** `git checkout dj && git pull origin dj && git rebase origin/main`

| Priority | Task | Status |
|----------|------|--------|
| P0 | `AuthService` + JWT storage | 🟡 On `dj` (`core/services/auth.service.ts`) |
| P0 | Dev proxy `/api` → `:4000` | 🟡 On `dj` (`proxy.conf.json`) |
| P0 | Wire login + signup | 🟡 On `dj` |
| P1 | Dashboard + timeline chart | 🟡 On `dj` (`features/dashboard/`) |
| P1 | Auth guard + post-login routing | 🟡 On `dj` (`core/guards/auth.guard.ts`) |

**Before PR:** rebase onto `main` (picks up PR #5 categorizer swap). **Remove `.tmp-gh/`** from branch — accidental gh CLI binary committed.

**Demo credentials:** `demo@timetracker.test` / `Demo1234!` → user ID `user-demo-1`

---

### Allisonmini — AI follow-ups

> **Delegated by PR review agent (2026-06-21):** PR #6 reviewed — **REQUEST CHANGES**. Rebase required before merge. Do not use `ai-pipeline` (merged/deleted); work on **`voice-demo`** only.

| Priority | Task | Status |
|----------|------|--------|
| P0 | `categoryHint` → `categorizationService` | ✅ Merged ([#5](https://github.com/Samar1006/time-tracker/pull/5)) |
| P1 | Voice demo page `/demo` | 🔴 PR [#6](https://github.com/Samar1006/time-tracker/pull/6) — **rebase + fix `app.js` conflict** |

**Branch:** `voice-demo` for PR #6 only.

**Your action items (PR #6):**

1. `git checkout voice-demo && git fetch origin && git rebase origin/main`
2. Resolve `server/src/app.js` — **keep both**:
   - `app.use('/api/auth', authRouter)` (from `main`)
   - `app.use('/demo', express.static(...))` (from your commit)
3. `cd server && npm test` — must pass **30/30** (includes auth tests)
4. `git push --force-with-lease origin voice-demo`
5. Comment on PR #6 when ready; PR review agent will merge

**Do not touch:** `frontend/time-tracker-app/` (Frontend team / `dj` branch).

---

### Samar / foreman

- Keep docs current; track branch health
- PR review agent merges PRs

---

## Branch status

| Branch | vs `main` | PR | Action |
|--------|-----------|-----|--------|
| `main` | — | — | 30 tests passing; categorizer swap merged |
| `dj` | **+1 / −2** | none open yet | Frontend integration — **rebase then PR** |
| `voice-demo` | +1 / −8 | [#6](https://github.com/Samar1006/time-tracker/pull/6) open | **Allisonmini:** rebase + `app.js` conflict (see above) |
| `categorizer-swap` | merged | [#5](https://github.com/Samar1006/time-tracker/pull/5) ✅ | Delete remote branch |
| `auth-backend`, `ingestion-timeline`, `ai-pipeline` | merged | — | Safe to delete |

---

## MVP progress

| # | Task | Status |
|---|------|--------|
| 1 | Activity ingest + timeline API | ✅ `main` |
| 2 | AI pipeline | ✅ `main` |
| 3 | JWT auth backend | ✅ `main` |
| 4 | Auth UI shell | ✅ `main` |
| 5 | Categorizer in aggregation | ✅ `main` (PR #5) |
| 6 | Frontend auth + dashboard wired | 🟡 `dj` branch |
| 7 | Voice demo page | 🟡 PR #6 |
| 8 | Native tracking | 🔲 P2 |

---

## How to test full stack (once `dj` rebased & merged)

```bash
# Terminal 1 — backend
cd server && npm install && npm run dev    # :4000

# Terminal 2 — frontend (from dj branch)
cd frontend/time-tracker-app && npm install && npm start   # :4200

# Login at http://localhost:4200/login
# demo@timetracker.test / Demo1234!
```

---

## Integration rules

1. **Frontend** → `dj` branch only (`frontend/time-tracker-app/`)
2. **AI** → `voice-demo` for PR #6; don't touch frontend
3. Update `API_CONTRACT.md` if API shapes change
