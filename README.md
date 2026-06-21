# time-tracker

Time tracker with automatic browser/Mac monitoring, voice logging, and an Apple Calendar–style day view.

## Features

- **Dashboard** — vertical day timeline, date navigation, pinch-to-zoom, scroll preservation
- **Voice logging** — mic → transcribe (Deepgram) → parse → timeline blocks; live transcript while recording
- **Voice mutations** — natural language edits (move/shift/shorten/cancel blocks) via voice commands
- **Chrome extension** — background tab/domain tracking → timeline
- **Mac menu bar app** — frontmost app focus tracking ([`clients/mac/`](clients/mac/))
- **Stats page** (`/stats`) — day/week/month breakdown
- **Category settings** (`/settings`) — customize AI categorization hints for voice parse
- **Auth** — email/password + Google sign-in; JWT on all activity routes

## Quick start

```bash
# Terminal 1 — backend
cd server && npm install && cp .env.example .env && npm run dev
```

```bash
# Terminal 2 — frontend
cd frontend/time-tracker-app && npm install && npm start
```

Open **http://localhost:4200** (mic requires `localhost`, not a LAN IP).

**Demo login:** `demo@timetracker.test` / `Demo1234!`

**Optional — Chrome extension:** load unpacked from [`browser-extension/`](browser-extension/) ([install guide](browser-extension/README.md)).

## Project layout

```
time-tracker/
├── server/                      Express API, Redis/memory store, AI parse
├── frontend/time-tracker-app/   Angular dashboard
├── browser-extension/           Chrome MV3 background monitor
├── clients/mac/                 macOS menu bar tracker
├── API_CONTRACT.md              API reference
└── DECISIONS.md                 Architecture notes
```

## Environment variables

Full list in [`server/.env.example`](server/.env.example). Summary:

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `DEEPGRAM_API_KEY` | For voice STT | Speech-to-text |
| `ANTHROPIC_API_KEY` | Optional | LLM schedule refine |
| `JWT_SECRET` | Optional locally | Auth tokens |
| `REDIS_URL` | Optional | Persistence (memory fallback OK for demo) |
| `GOOGLE_CLIENT_ID` | For Google login | OAuth web client ID |

## Testing

```bash
cd server && npm test          # 97 tests, no keys required
cd frontend/time-tracker-app && npm run build
```

## Demo script

1. **Login** → dashboard shows vertical timeline
2. **Browse** github.com in Chrome → switch tab → block appears
3. **Log with voice** → “From 9 to 10 AM coding” → block at 9 AM
4. Visit **`/stats`** and **`/settings`**

## Team / components

| Area | Folder |
|------|--------|
| Backend API | `server/` |
| Angular UI | `frontend/time-tracker-app/` |
| Extension | `browser-extension/` |
| Mac client | `clients/mac/` |

## Links

- **API:** [`API_CONTRACT.md`](API_CONTRACT.md)
- **Server setup:** [`server/README.md`](server/README.md)
- **Extension:** [`browser-extension/README.md`](browser-extension/README.md)
- **Mac app:** [`clients/mac/README.md`](clients/mac/README.md)
- **Client event contract:** [`clients/INTEGRATION.md`](clients/INTEGRATION.md)
- **Agent / architecture:** [`AGENTS.md`](AGENTS.md), [`DECISIONS.md`](DECISIONS.md)
