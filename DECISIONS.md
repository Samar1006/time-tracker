# Architecture Decisions

> Record significant decisions here. Include date, context, and consequences. Do not silently reverse a decision without a new entry.

---

## ADR-001 — Backend folder is `server/`, not `backend/`

**Date:** 2025-06-20  
**Status:** Accepted  
**Context:** `main` was scaffolded with empty `backend/` and `frontend/` directories. The AI pipeline branch introduced a working Express app under `server/`.  
**Decision:** All backend code lives in `server/`. Treat `backend/` as deprecated; remove `.gitkeep` when merging the first server PR.  
**Consequences:** Docs and env files reference `server/`. Native trackers and frontend should target `http://localhost:4000` (or configured `PORT`).

---

## ADR-002 — Split backend ownership by vertical slice

**Date:** 2025-06-20  
**Status:** Accepted  

| Slice | Owner | Responsibility |
|-------|-------|----------------|
| Ingestion & timeline | Samar | Raw events → Redis → hour buckets → `GET /api/timeline` |
| AI & voice | Allisonmini | Deepgram STT, transcript → blocks, categorization |

**Decision:** Two feature branches merge sequentially into `main`. Shared touchpoints: `server/src/app.js`, `server/package.json`, `API_CONTRACT.md`. Each owner avoids editing the other's primary files in the same PR.  
**Consequences:** Small PRs; foreman reviews router wiring and contract alignment at merge time.

---

## ADR-003 — Offline-first AI pipeline for hackathon velocity

**Date:** 2025-06-20 (from `ai-pipeline` implementation)  
**Status:** Accepted  
**Context:** Demo must work without all API keys at once.  
**Decision:**
- Schedule parsing uses heuristic parser by default; LLM refinement is opt-in (`useLLM: true`) when `OPENAI_API_KEY` is set.
- Categorization uses keyword/domain maps by default; Redis vector similarity is optional and currently a no-op seam.
- Deepgram is only required for live audio; tests use pure helpers (`extractTranscript`, etc.).

**Consequences:** `npm test` passes with zero secrets. Live voice demo requires `DEEPGRAM_API_KEY`.

---

## ADR-004 — Two block shapes: timeline (ISO) vs schedule (HH:MM)

**Date:** 2025-06-20  
**Status:** Accepted  
**Context:** Tracked events have full timestamps; spoken schedules often lack calendar dates.  
**Decision:**
- **Timeline blocks** use ISO 8601 UTC + `date` + `hour` index for bar chart.
- **Schedule blocks** use `HH:MM` local wall-clock until integrated with a calendar day.

**Consequences:** Frontend may anchor voice blocks to “today” for demo. Full merge of voice + tracked data is post-MVP unless team prioritizes in `TASKS.md`.

---

## ADR-005 — Demo data over perfect native tracking for MVP

**Date:** 2025-06-20  
**Status:** Accepted  
**Decision:** MVP demo must work with mocked activity events and sample transcripts. Native macOS/iOS/browser capture is P2.  
**Consequences:** Samar ships `demoTimeline.json` + mock event script; frontend never blocks on native trackers.

---

## ADR-006 — Protected `main`; integrate via PR

**Date:** 2025-06-20  
**Status:** Accepted  
**Decision:** Foreman reviews PRs for contract compliance before merge. Prefer incremental PRs (< ~400 lines) per slice.  
**Consequences:** `ai-pipeline` should merge before or coordinate with ingestion branch on `package.json` / `app.js`.

---

## ADR-007 — Activity API paths under `/api/activity/*`

**Date:** 2025-06-20  
**Status:** Proposed (pending team ack)  
**Context:** Original MVP listed `POST /events` and `GET /timeline`. Samar's implementation uses namespaced routes.  
**Decision (proposed):** Use `/api/activity/events`, `/api/activity/hourly`, etc. Avoid breaking working code for naming alone; add aliases only if frontend strongly prefers shorter paths.  
**Consequences:** `API_CONTRACT.md` and frontend docs reference `/api/activity/*`.

---

## ADR-008 — Redis key pattern for raw events

**Date:** 2025-06-20  
**Status:** Accepted (implemented on `samar` branch)  
**Decision:** Store JSON-serialized events in a Redis list at `activity:events:{userId}:{YYYY-MM-DD}`. In-memory `Map` fallback when `REDIS_URL` is unset.  
**Consequences:** Allison's optional vector Redis usage is separate; no key collision today.

---

## ADR-009 — Activity event shape uses intervals, not point timestamps

**Date:** 2025-06-20  
**Status:** Accepted (implemented)  
**Context:** macOS/iOS trackers naturally produce focus intervals (`startedAt`/`endedAt`).  
**Decision:** Raw events require `startedAt`, `endedAt`, and `label` rather than a single `timestamp` + `durationSec`.  
**Consequences:** Clients must send intervals; aggregation splits across hour boundaries in UTC.

---

## Pending decisions (need team input)

See **Questions** in `TASKS.md`:

- Confirm ADR-007 route naming
- Default timezone handling (currently UTC only)
- Frontend stack and owner
- Whether voice blocks merge into timeline API for v1
- Server-side vs client-side categorization for activity blocks
