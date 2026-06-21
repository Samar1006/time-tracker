// activityStore.js — persist and load raw activity events for a user/day.

import { deleteKey, listLength, listPush, listRange, listRangeMany, listSet } from './redisClient.js';
import { sumTrackedSec } from './aggregationService.js';

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
  return parseStoredEvents(raw);
}

export async function countEvents(userId, date) {
  return listLength(eventsKey(userId, date));
}

export async function clearEvents(userId, date) {
  await deleteKey(eventsKey(userId, date));
}

/**
 * Replace the full event list for a user/day (used by updates).
 * @param {string} userId
 * @param {string} date YYYY-MM-DD
 * @param {StoredEvent[]} events
 */
export async function saveEvents(userId, date, events) {
  const key = eventsKey(userId, date);
  await listSet(key, events.map((event) => JSON.stringify(event)));
  return { stored: events.length, key };
}

/**
 * @param {string} userId
 * @param {string} date
 * @param {string} eventId
 * @returns {Promise<{ event: StoredEvent, index: number } | null>}
 */
export async function findEventOnDay(userId, date, eventId) {
  const events = await loadEvents(userId, date);
  const index = events.findIndex((e) => e.id === eventId);
  if (index === -1) return null;
  return { event: events[index], index };
}

/**
 * Update one event, optionally moving it to another storage day.
 * @returns {Promise<StoredEvent | null>}
 */
export async function replaceEvent(userId, fromDate, eventId, updatedEvent) {
  const found = await findEventOnDay(userId, fromDate, eventId);
  if (!found) return null;

  const toDate = eventStorageDate(updatedEvent) ?? fromDate;
  const events = await loadEvents(userId, fromDate);
  const next = events.filter((e) => e.id !== eventId);

  if (toDate === fromDate) {
    next.push(updatedEvent);
    await saveEvents(userId, fromDate, next);
    return updatedEvent;
  }

  await saveEvents(userId, fromDate, next);
  await appendEvents(userId, toDate, [updatedEvent]);
  return updatedEvent;
}

function eventStorageDate(event) {
  const localDate = event.metadata?.localDate;
  if (localDate && /^\d{4}-\d{2}-\d{2}$/.test(String(localDate))) {
    return String(localDate);
  }
  const ts = event.timestamp;
  if (!ts) return null;
  const match = String(ts).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function parseStoredEvents(raw) {
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

/**
 * @param {string} userId
 * @param {string} month YYYY-MM
 * @returns {Promise<{ date: string, totalTrackedSec: number }[]>}
 */
export async function loadMonthDayTotals(userId, month) {
  const [year, monthNum] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const dates = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return `${month}-${String(day).padStart(2, '0')}`;
  });
  const keys = dates.map((date) => eventsKey(userId, date));
  const batches = await listRangeMany(keys);

  return dates.map((date) => {
    const raw = batches.get(eventsKey(userId, date)) ?? [];
    const events = parseStoredEvents(raw);
    return {
      date,
      totalTrackedSec: events.length === 0 ? 0 : sumTrackedSec(events),
    };
  });
}

export default {
  DEFAULT_USER_ID,
  eventsKey,
  appendEvents,
  loadEvents,
  countEvents,
  clearEvents,
  saveEvents,
  findEventOnDay,
  replaceEvent,
  loadMonthDayTotals,
};
