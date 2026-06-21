// app.js — Express app wiring. Kept separate from server.js so tests can
// import the app without binding a port.
import express from 'express';
import cors from 'cors';
import activityRouter from './routes/activity.js';
import authRouter from './routes/auth.js';
import scheduleRouter from './routes/schedule.js';
import { transcribeUrl, transcribeBuffer } from './services/deepgramService.js';
import { categorizeDomain, categorizeActivity } from './services/categorizationService.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Auth — login, signup, JWT sessions.
  app.use('/api/auth', authRouter);

  // Samar — activity ingestion, storage, hour-by-hour timeline.
  app.use('/api', activityRouter);

  // Allison — AI & voice pipeline.
  app.use('/api/schedule', scheduleRouter);

  // Speech-to-text. Accepts a hosted audio URL { url } or base64 audio
  // { audioBase64 }. Requires DEEPGRAM_API_KEY.
  app.post('/api/transcribe', async (req, res) => {
    const { url, audioBase64 } = req.body ?? {};
    if (!url && !audioBase64) {
      return res.status(400).json({ error: 'Provide "url" or "audioBase64".' });
    }
    try {
      const result = url
        ? await transcribeUrl(url)
        : await transcribeBuffer(Buffer.from(audioBase64, 'base64'));
      res.json({ transcript: result.transcript, words: result.words });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // Categorization (used by frontend/demo and by Samar's aggregation).
  app.post('/api/categorize/domain', (req, res) => {
    const { domain } = req.body ?? {};
    if (!domain) return res.status(400).json({ error: 'Provide "domain".' });
    res.json(categorizeDomain(domain));
  });

  app.post('/api/categorize/activity', async (req, res) => {
    const { text, useVector } = req.body ?? {};
    if (!text) return res.status(400).json({ error: 'Provide "text".' });
    res.json(await categorizeActivity(text, { useVector: !!useVector }));
  });

  return app;
}

export default createApp;
