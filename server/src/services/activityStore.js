// activityStore.js — persist and load raw activity events for a user/day.

import { deleteKey, listLength, listPush, listRange } from './redisClient.js';

export const DEFAULT_USER_ID = 'user-demo-1';

export function eventsKey(userId, date) {
  return `events:${userId}:${date}`;
}

/**
 * @typedef {Object} StoredEvent
 * @property {string} id
 * @property {string} userId
 * @property {string} timestamp ISO-8601 start
 * @property {string} type
 * @property {string} [app]
 * @property {string} [domain]
 * @property {string} [title]
 * @property {number} [durationSec]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @param {string} userId
 * @param {string} date YYYY-MM-DD
 * @param {StoredEvent[]} events
 */
export async function appendEvents(userId, date, events) {
  const key = eventsKey(userId, date);
  for (const event of events) {
    await listPush(key, JSON.stringify(event));
  }
  return { stored: events.length, key };
}

/**
 * @param {string} userId
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<StoredEvent[]>}
 */
export async function loadEvents(userId, date) {
  const key = eventsKey(userId, date);
  const raw = await listRange(key);
  return raw
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function countEvents(userId, date) {
  return listLength(eventsKey(userId, date));
}

export async function clearEvents(userId, date) {
  await deleteKey(eventsKey(userId, date));
}

export default {
  DEFAULT_USER_ID,
  eventsKey,
  appendEvents,
  loadEvents,
  countEvents,
  clearEvents,
};
