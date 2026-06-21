import http from 'node:http';
import { createApp } from '../../src/app.js';

let server;
let baseUrl;

export async function startTestServer() {
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
}

export async function stopTestServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  server = null;
  baseUrl = null;
}

export async function request(path, { method = 'GET', body, headers = {} } = {}) {
  if (!baseUrl) throw new Error('Call startTestServer() first');

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: res.status, body: parsed };
}

export default { startTestServer, stopTestServer, request };
