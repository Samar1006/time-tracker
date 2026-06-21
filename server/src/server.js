// server.js — process entry point.
import 'dotenv/config';
import { createApp } from './app.js';
import { warmUpRedis } from './services/redisClient.js';

const port = Number(process.env.PORT) || 4000;
createApp().listen(port, () => {
  console.log(`time-tracker server listening on http://localhost:${port}`);
  void warmUpRedis();
});
