# Browser extension — background monitor

Chrome extension (Manifest V3) that tracks **active tab URLs** in the background and sends `domain_visit` events to `POST /api/events`.

## Quick start

1. **Start backend:** `cd server && npm start` (port 4000)
2. **Start frontend:** `cd frontend/time-tracker-app && ng serve` (port 4200)
3. **Install extension:** Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select this folder
4. **Log in:** http://localhost:4200/login  
   Demo: `demo@timetracker.test` / `Demo1234!`
5. **Open dashboard** — your user ID syncs to the extension automatically
6. **Browse** any website in Chrome for 30+ seconds, then switch tabs
7. **Dashboard** shows activity on the timeline within ~30 seconds

## How it works

```
Chrome active tab  →  extension session  →  POST /api/events
                                              ↓
Dashboard login    →  userId sync         →  Redis/memory
                                              ↓
GET /api/timeline  ←  hour-by-hour chart  ←  aggregation
```

- Records time on each active tab (domain + page title)
- Flushes when you switch tabs, change URL, blur window, go idle, or every **60 seconds**
- Skips visits shorter than **3 seconds** and internal pages (`chrome://`, etc.)
- **Offline queue:** failed posts are retried when the server comes back
- Events use your **local date** so evening browsing appears on the correct day

## Extension popup

Click the toolbar icon to see:
- Tracking status and user ID
- Current tab hostname
- Pending events waiting to sync

Green **✓** badge = event saved. Red **!** = server unreachable.

## Configuration (Options)

| Setting | Default | Notes |
|---------|---------|-------|
| User ID | `user-demo-1` | Auto-synced from dashboard when logged in |
| API URL | `http://localhost:4000` | Backend base URL |
| Enabled | on | Toggle to pause tracking |

## Files

| File | Role |
|------|------|
| `background.js` | Service worker — tab tracking, API posts, offline queue |
| `content-bridge.js` | Syncs logged-in userId from dashboard → extension storage |
| `options.html` / `options.js` | User ID + API URL settings |
| `popup.html` / `popup.js` | Status popup |
| `manifest.json` | MV3 permissions |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Dashboard shows 0m | Reload extension after code changes; browse 30+ sec then switch tabs |
| Extension not detected | Load unpacked from this folder; use Chrome (not Safari) |
| Red ! badge | Start server: `cd server && npm start` |
| Wrong user | Open dashboard while logged in to sync userId |
| Slow machine | Disable extension when not testing (`chrome://extensions`) |
