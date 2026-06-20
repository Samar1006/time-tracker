// Express app wiring. Kept separate from server.js so tests can import
// the app without binding a port.
import express from 'express';
import cors from 'cors';
import activityRouter from './routes/activity.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', activityRouter);

  return app;
}

export default createApp;
