# Browser extension — background monitor

Chrome extension (Manifest V3) that tracks **active tab URLs** in the background and sends `domain_visit` events to `POST /api/events`.

## Install (local dev)

1. Start the backend: `cd server && npm start`
2. Open Chrome → **Extensions** → enable **Developer mode**
3. Click **Load unpacked** → select this `browser-extension/` folder
4. Open extension **Options** and set:
   - **User ID** — your account id (e.g. `user-demo-1` after demo login)
   - **API base URL** — `http://localhost:4000`

## How it works

- Records time on each active tab (domain + page title)
- Flushes an event when you switch tabs, change URL, blur the window, go idle, or every 30 seconds
- Skips very short visits (< 5 seconds) and internal browser pages (`chrome://`, etc.)
- Events match the API contract raw event shape (`type: domain_visit`, `app: Chrome`)

## View on dashboard

Open the Angular app → **Dashboard**. The **calendar** shows tracked time per day; click a day to see the hour-by-hour breakdown for websites recorded by this extension.

## Files

| File | Role |
|------|------|
| `background.js` | Service worker — tab tracking + API posts |
| `options.html` | User ID + API URL configuration |
| `popup.html` | Quick status + link to settings |
