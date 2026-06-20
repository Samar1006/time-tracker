// server.js — process entry point.
import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;
createApp().listen(port, () => {
  console.log(`time-tracker server listening on http://localhost:${port}`);
});
