#!/usr/bin/env node
/**
 * Test Redis Cloud connectivity. Run: npm run redis:test
 * Does not print your password.
 */
import 'dotenv/config';
import { createConnection } from 'node:net';
import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL?.trim();

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username || 'default'}:***@${parsed.hostname}:${parsed.port || '6379'}`;
  } catch {
    return '(invalid REDIS_URL)';
  }
}

async function fetchPublicIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return data.ip ?? null;
  } catch {
    return null;
  }
}

function testTcp(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.on('connect', () => done({ ok: true, message: `TCP port ${port} reachable` }));
    socket.on('timeout', () => done({ ok: false, message: `TCP timeout on ${host}:${port}` }));
    socket.on('error', (err) => done({ ok: false, message: `TCP error: ${err.message}` }));
  });
}

async function testRedisUrl(url, label) {
  const client = createClient({
    url,
    socket: { connectTimeout: 10000, reconnectStrategy: false },
  });
  client.on('error', () => {});
  const started = Date.now();
  try {
    await Promise.race([
      client.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout 10s')), 10000)),
    ]);
    const pong = await client.ping();
    await client.destroy();
    return { ok: true, label, ms: Date.now() - started, message: `PING → ${pong}` };
  } catch (err) {
    try {
      await client.destroy();
    } catch {
      /* ignore */
    }
    return { ok: false, label, ms: Date.now() - started, message: err.message };
  }
}

async function main() {
  console.log('Redis Cloud connection test\n');

  if (!REDIS_URL) {
    console.error('REDIS_URL is not set in server/.env');
    process.exit(1);
  }

  console.log('Target:', maskUrl(REDIS_URL));

  const publicIp = await fetchPublicIp();
  if (publicIp) {
    console.log('\nYour public IP (add to Redis Cloud CIDR allow list):');
    console.log(`  ${publicIp}/32`);
    console.log('  Or for hackathon dev only: 0.0.0.0/0');
  }

  let parsed;
  try {
    parsed = new URL(REDIS_URL);
  } catch {
    console.error('\nREDIS_URL is not a valid URL.');
    process.exit(1);
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || 6379);

  console.log('\n--- Step 1: TCP ---');
  const tcp = await testTcp(host, port);
  console.log(tcp.ok ? `✓ ${tcp.message}` : `✗ ${tcp.message}`);

  console.log('\n--- Step 2: Redis protocol ---');
  const schemes = [REDIS_URL];
  const alt = REDIS_URL.startsWith('redis://')
    ? REDIS_URL.replace('redis://', 'rediss://')
    : REDIS_URL.replace('rediss://', 'redis://');
  if (alt !== REDIS_URL) schemes.push(alt);

  let anyOk = false;
  for (const url of schemes) {
    const label = url.startsWith('rediss://') ? 'rediss (TLS)' : 'redis (plain)';
    const result = await testRedisUrl(url, label);
    console.log(result.ok ? `✓ ${label}: ${result.message} (${result.ms}ms)` : `✗ ${label}: ${result.message}`);
    if (result.ok) anyOk = true;
  }

  console.log('\n--- What to do in Redis Cloud ---');
  console.log('1. https://cloud.redis.io → your database');
  console.log('2. Configuration → Security → enable CIDR allow list');
  if (publicIp) console.log(`3. Add: ${publicIp}/32  (or 0.0.0.0/0 for dev)`);
  console.log('4. Ensure Public endpoint is enabled');
  console.log('5. Connect tab → copy Public URL exactly into REDIS_URL');
  console.log('6. Restart: npm start');
  console.log('7. Verify: curl http://localhost:4000/api/timeline/health  →  "storage":"redis"');

  process.exit(anyOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
