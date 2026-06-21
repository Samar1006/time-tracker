// redisClient.js — shared Redis connection with in-memory fallback.
// Activity ingestion works fully offline when REDIS_URL is unset.

const OP_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 10_000;

let _client = null;
let _mode = 'memory'; // 'redis' | 'memory'
let _connectFailed = false;
let _loggedFallback = false;
/** @type {Promise<import('redis').RedisClientType | null> | null} */
let _connectPromise = null;

/** @type {Map<string, string[]>} */
const memoryLists = new Map();

function memoryKey(key) {
  if (!memoryLists.has(key)) memoryLists.set(key, []);
  return memoryLists.get(key);
}

function swallowErrors(client) {
  if (!client) return;
  client.on('error', () => {});
}

function withTimeout(promise, ms, label, onTimeout) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        if (onTimeout) onTimeout();
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    }),
  ]);
}

function logFallback(reason) {
  if (_loggedFallback) return;
  _loggedFallback = true;
  console.warn('[redisClient] falling back to memory:', reason?.message ?? reason);
  console.warn(
    '[redisClient] Redis Cloud checklist: Public endpoint ON, allow your IP (or 0.0.0.0/0), copy exact URL from Connect tab.',
  );
}

async function destroyClient(client) {
  if (!client) return;
  swallowErrors(client);
  try {
    await client.destroy();
  } catch {
    // ignore cleanup errors
  }
}

function disableRedis(reason, clientToDestroy = _client, { permanent = true } = {}) {
  logFallback(reason);
  void destroyClient(clientToDestroy);
  _client = null;
  _mode = 'memory';
  _connectPromise = null;
  if (permanent) _connectFailed = true;
}

export function getStorageMode() {
  return _mode;
}

export async function getRedisClient() {
  if (_client?.isOpen) return _client;
  if (!process.env.REDIS_URL || _connectFailed) {
    _mode = 'memory';
    return null;
  }
  if (_connectPromise) return _connectPromise;

  _connectPromise = (async () => {
    let client = null;
    try {
      const { createClient } = await import('redis');
      client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: CONNECT_TIMEOUT_MS,
          reconnectStrategy: () => false,
        },
      });
      swallowErrors(client);

      await withTimeout(
        client.connect(),
        CONNECT_TIMEOUT_MS,
        'Redis connect',
        () => {
          void destroyClient(client);
        },
      );

      _client = client;
      _mode = 'redis';
      console.info('[redisClient] connected to Redis');
      return client;
    } catch (err) {
      disableRedis(err, client);
      return null;
    }
  })();

  return _connectPromise;
}

/** Optional warm-up — never throws; server keeps running if Redis is unreachable. */
export async function warmUpRedis() {
  try {
    await getRedisClient();
  } catch {
    disableRedis(new Error('Redis warm-up failed'));
  }
}

async function runRedisOp(label, op, fallback) {
  try {
    const client = await getRedisClient();
    if (!client) return fallback();
    return await withTimeout(op(client), OP_TIMEOUT_MS, label);
  } catch (err) {
    const msg = String(err?.message ?? err);
    const isConnectFailure = msg.includes('connect') || msg.includes('ECONNREFUSED');
    disableRedis(err, _client, { permanent: isConnectFailure });

    // Transient op timeout — reconnect once instead of staying on empty memory forever.
    if (!isConnectFailure && process.env.REDIS_URL && !_connectFailed) {
      try {
        const client = await getRedisClient();
        if (client) return await withTimeout(op(client), OP_TIMEOUT_MS, label);
      } catch (retryErr) {
        disableRedis(retryErr, _client, { permanent: false });
      }
    }
    return fallback();
  }
}

export async function listPush(key, value) {
  await runRedisOp(
    'listPush',
    (client) => client.rPush(key, value),
    () => {
      memoryKey(key).push(value);
    },
  );
}

export async function listRange(key, start = 0, stop = -1) {
  return runRedisOp(
    'listRange',
    (client) => client.lRange(key, start, stop),
    () => {
      const list = memoryKey(key);
      const end = stop < 0 ? list.length : stop + 1;
      return list.slice(start, end);
    },
  );
}

export async function listLength(key) {
  return runRedisOp(
    'listLength',
    (client) => client.lLen(key),
    () => memoryKey(key).length,
  );
}

export async function deleteKey(key) {
  await runRedisOp(
    'deleteKey',
    (client) => client.del(key),
    () => {
      memoryLists.delete(key);
    },
  );
}

/** Batch LRANGE in one round trip (month summary). */
export async function listRangeMany(keys) {
  if (keys.length === 0) return new Map();

  return runRedisOp(
    'listRangeMany',
    async (client) => {
      const multi = client.multi();
      for (const key of keys) multi.lRange(key, 0, -1);
      const replies = await multi.exec();
      const map = new Map();
      keys.forEach((key, index) => {
        map.set(key, replies?.[index] ?? []);
      });
      return map;
    },
    () => {
      const map = new Map();
      for (const key of keys) {
        map.set(key, [...memoryKey(key)]);
      }
      return map;
    },
  );
}

export async function listSet(key, values) {
  await runRedisOp(
    'listSet',
    async (client) => {
      const multi = client.multi();
      multi.del(key);
      if (values.length > 0) multi.rPush(key, values);
      await multi.exec();
    },
    () => {
      memoryLists.set(key, [...values]);
    },
  );
}

/** Test helper — clears in-memory fallback between tests. */
export function resetMemoryStore() {
  memoryLists.clear();
  if (_client) void destroyClient(_client);
  _client = null;
  _mode = 'memory';
  _connectPromise = null;
  _connectFailed = false;
  _loggedFallback = false;
}

export default {
  getStorageMode,
  getRedisClient,
  warmUpRedis,
  listPush,
  listRange,
  listRangeMany,
  listLength,
  deleteKey,
  listSet,
  resetMemoryStore,
};
