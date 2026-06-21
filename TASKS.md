# Tasks

> **All agents:** Read this file and [`API_CONTRACT.md`](API_CONTRACT.md) before starting work. Update your task status when you finish.

**Last foreman check:** 2026-06-21 — all backend + auth merged; frontend integration is next

---

## Team delegation (current sprint)

> **Important:** `ai-pipeline` and `dj` are **merged into `main`**. Do not keep building on those old branch names. Branch fresh from `main`.

### Allisonmini — AI follow-ups

**Branch from `main`:** `git checkout main && git pull && git checkout -b ai-followups`

| Priority | Task | Owns | Do NOT touch |
|----------|------|------|--------------|
| P0 | Replace `categoryHint` → `categorizationService` in timeline aggregation | `server/src/services/aggregationService.js` | `frontend/`, `auth.js`, `activity.js` |
| P1 | Voice demo polish: document `/api/transcribe` → `/api/schedule/parse` chain | `server/README.md` | Frontend |
| P2 | Deepgram live demo error handling | `server/src/app.js` transcribe handler | — |

**Done (on `main`, don't redo):** schedule parse, categorize, transcribe, Deepgram service.

---

### Frontend team — integration + timeline UI

**Branch from `main`:** `git checkout main && git pull && git checkout -b frontend-integration`

| Priority | Task | Owns | Do NOT touch |
|----------|------|------|--------------|
| P0 | `AuthService` → `POST /api/auth/login`, `/signup`, `/me`; store JWT | `frontend/time-tracker-app/src/app/` | `server/` |
| P0 | Dev proxy: `/api` → `http://localhost:4000` | `frontend/time-tracker-app/angular.json` | — |
| P0 | Wire login + signup components (remove TODOs) | `login.component.ts`, `signup.component.ts` | — |
| P1 | Timeline page + hour bar chart | new feature module | — |
| P1 | Post-login route → timeline (use `user.id` from auth response) | `app.routes.ts` | — |
| P2 | Google OAuth button | **Skip for hackathon** — no backend support yet | — |

**Demo credentials** (see `server/README.md`):
- Email: `demo@timetracker.test` / Password: `Demo1234!` / User ID: `user-demo-1`

**Done (on `main`, don't redo):** login/signup UI shell, auth layout.

---

### Samar / foreman — integration only

- Keep `API_CONTRACT.md`, `TASKS.md`, `DECISIONS.md` current
- Track branch health; do not build features unless asked
- PR review agent handles merge approval

---

## Branch status

| Branch | Status | Action |
|--------|--------|--------|
| `main` | 🟢 Full backend + auth API + auth UI shell (30 tests) | Everyone branches from here |
| `ai-pipeline` | ⚪ Merged & deleted | Use `ai-followups` for new AI work |
| `dj` | ⚪ Merged | Use `frontend-integration` for new frontend work |
| `ingestion-timeline` | ⚪ Merged & deleted | — |
| `auth-backend` | ⚪ Merged | Delete local/remote if still around |

---

## MVP progress

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Activity ingest + Redis | Samar | ✅ `main` |
| 2 | Timeline API + demo seed | Samar | ✅ `main` |
| 3 | AI pipeline (schedule, categorize, transcribe) | Allisonmini | ✅ `main` |
| 4 | JWT auth backend | Samar | ✅ `main` |
| 5 | Auth UI shell (Angular) | Frontend | ✅ `main` (not wired) |
| 6 | Wire auth UI → auth API | Frontend | 🔲 `frontend-integration` |
| 7 | Timeline bar chart | Frontend | 🔲 `frontend-integration` |
| 8 | `categoryHint` → `categorizationService` | Allisonmini | 🔲 `ai-followups` |
| 9 | Native tracking | TBD | 🔲 P2 |

---

## Integration rules (avoid conflicts)

1. **AI teammate** edits only `server/` files they own (aggregation categorization swap, AI docs).
2. **Frontend teammate** edits only `frontend/time-tracker-app/`.
3. **Never** change API routes or shapes without updating `API_CONTRACT.md` in the same PR.
4. **Never** re-scaffold `server/package.json` or `app.js` — both slices already merged.

---

## Quick local test

```bash
# Backend
cd server && npm install && npm run dev   # :4000

# Auth
curl http://localhost:4000/api/auth/demo-account
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@timetracker.test","password":"Demo1234!"}'

# Timeline
curl "http://localhost:4000/api/timeline?userId=user-demo-1&date=2026-06-20"

# Frontend (UI only — not wired yet)
cd frontend/time-tracker-app && npm install && npm start   # :4200
```

---

## Questions for the team

1. Frontend owner name for the delegation table?
2. Should `/api/timeline` require JWT, or keep `userId` query param for hackathon?
3. Delete stale `auth-backend` branch?
