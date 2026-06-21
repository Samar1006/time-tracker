# Agent instructions — time-tracker hackathon

**Before doing any work, read these files in order:**

1. [`TASKS.md`](TASKS.md) — your assigned tasks, branch names, what not to touch
2. [`API_CONTRACT.md`](API_CONTRACT.md) — API routes, request/response shapes, env vars
3. [`DECISIONS.md`](DECISIONS.md) — architecture decisions (don't reverse silently)

## Branch rules

- **`main`** is the integration branch. All work starts with `git checkout main && git pull`.
- **Do not use merged branch names** (`ai-pipeline`, `dj`, `ingestion-timeline`) for new work.
- Use the branch names in `TASKS.md` for your role (`ai-followups`, `frontend-integration`).

## Role detection

| If you're working on… | Read section in TASKS.md | Primary folder |
|----------------------|--------------------------|----------------|
| AI / voice / categorization | Allisonmini — AI follow-ups | `server/src/services/`, `server/src/routes/schedule.js` |
| Frontend / Angular / timeline UI | Frontend team — integration | `frontend/time-tracker-app/` |
| Ingestion / auth / Redis / timeline API | Already on `main` — only fix bugs if asked | `server/src/routes/activity.js`, `server/src/routes/auth.js` |

## Hard rules

- Do not change API routes or schemas without updating `API_CONTRACT.md`.
- Do not edit files outside your ownership section in `TASKS.md`.
- Do not introduce new dependencies without stating why in the PR.
- Prefer small PRs to `main`.

## Foreman vs PR review

- **Foreman agent** — branch coordination, keeps docs current (does not review/merge PRs).
- **PR review agent** — reviews and merges PRs.

When in doubt, add a question to `TASKS.md` instead of guessing.
