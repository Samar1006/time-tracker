// redisClient.js — shared Redis connection with in-memory fallback.
// Activity ingestion works fully offline when REDIS_URL is unset.

let _client = null;
let _mode = 'memory'; // 'redis' | 'memory'
let _connectAttempted = false;

/** @type {Map<string, string[]>} */
const memoryLists = new Map();

function memoryKey(key) {
  if (!memoryLists.has(key)) memoryLists.set(key, []);
  return memoryLists.get(key);
}

export function getStorageMode() {
  return _mode;
}

export async function getRedisClient() {
  if (_connectAttempted) return _client;
  _connectAttempted = true;

  if (!process.env.REDIS_URL) {
    _mode = 'memory';
    return null;
  }

  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', () => {});
    await client.connect();
    _client = client;
    _mode = 'redis';
  } catch {
    _client = null;
    _mode = 'memory';
  }

  return _client;
}

export async function listPush(key, value) {
  const client = await getRedisClient();
  if (client) {
    await client.rPush(key, value);
    return;
  }
  memoryKey(key).push(value);
}

export async function listRange(key, start = 0, stop = -1) {
  const client = await getRedisClient();
  if (client) return client.lRange(key, start, stop);
  const list = memoryKey(key);
  const end = stop < 0 ? list.length : stop + 1;
  return list.slice(start, end);
}

export async function listLength(key) {
  const client = await getRedisClient();
  if (client) return client.lLen(key);
  return memoryKey(key).length;
}

export async function deleteKey(key) {
  const client = await getRedisClient();
  if (client) {
    await client.del(key);
    return;
  }
  memoryLists.delete(key);
}

/** Test helper — clears in-memory fallback between tests. */
export function resetMemoryStore() {
  memoryLists.clear();
  _client = null;
  _mode = 'memory';
  _connectAttempted = false;
}

export default {
  getStorageMode,
  getRedisClient,
  listPush,
  listRange,
  listLength,
  deleteKey,
  resetMemoryStore,
};
