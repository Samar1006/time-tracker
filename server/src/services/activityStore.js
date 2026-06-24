// activityStore.js — persist and load raw activity events for a user/day.

import { deleteKey, listLength, listPush, listRange, listRangeMany, listSet } from './redisClient.js';
import { addDaysISO, sumTrackedSec } from './aggregationService.js';

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

export function eventStorageDate(event) {
  const localDate = event.metadata?.localDate;
  if (localDate && /^\d{4}-\d{2}-\d{2}$/.test(String(localDate))) {
    return String(localDate);
  }
  const ts = event.timestamp;
  if (!ts) return null;
  const match = String(ts).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

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
 * @returns {Promise<{ event: StoredEvent, index: number, storageDate: string } | null>}
 */
export async function findEventOnDay(userId, date, eventId) {
  const events = await loadEvents(userId, date);
  const index = events.findIndex((e) => e.id === eventId);
  if (index === -1) return null;
  return { event: events[index], index, storageDate: date };
}

function buildSearchDates(storageDateHint, updatedEvent, extraDates = []) {
  const seeds = new Set([
    storageDateHint,
    eventStorageDate(updatedEvent),
    ...extraDates,
  ].filter(Boolean));

  const dates = new Set();
  for (const seed of seeds) {
    dates.add(seed);
    for (let offset = -14; offset <= 14; offset += 1) {
      dates.add(addDaysISO(seed, offset));
    }
  }

  return [...dates];
}

/**
 * Remove an event id from every searched day bucket (cleans up stale duplicates).
 * @returns {Promise<number>} buckets updated
 */
export async function deleteEventEverywhere(userId, eventId, searchDates) {
  let removed = 0;
  for (const date of searchDates) {
    const events = await loadEvents(userId, date);
    if (!events.some((e) => e.id === eventId)) continue;
    const next = events.filter((e) => e.id !== eventId);
    await saveEvents(userId, date, next);
    removed += 1;
  }
  return removed;
}

async function removeEventById(userId, eventId, searchDates) {
  const removed = await deleteEventEverywhere(userId, eventId, searchDates);
  return removed > 0 ? true : null;
}

/**
 * Locate and remove one stored event (cleans stale copies across nearby days).
 * @returns {Promise<StoredEvent | null>}
 */
export async function deleteStoredEvent(userId, eventId, dateHint) {
  const initialDates = buildSearchDates(dateHint, { metadata: { localDate: dateHint } }, []);
  let located = null;
  for (const date of initialDates) {
    located = await findEventOnDay(userId, date, eventId);
    if (located) break;
  }
  if (!located) return null;

  const searchDates = buildSearchDates(located.storageDate, located.event, dateHint ? [dateHint] : []);
  await deleteEventEverywhere(userId, eventId, searchDates);
  return located.event;
}

/**
 * Update one event, moving it between storage days when needed.
 * Scans nearby days so stale copies are not left behind.
 * @returns {Promise<StoredEvent | null>}
 */
export async function replaceEvent(userId, storageDateHint, eventId, updatedEvent, extraSearchDates = []) {
  const searchDates = buildSearchDates(storageDateHint, updatedEvent, extraSearchDates);
  let located = null;
  for (const date of searchDates) {
    located = await findEventOnDay(userId, date, eventId);
    if (located) break;
  }
  if (!located) return null;

  const toDate = eventStorageDate(updatedEvent) ?? located.storageDate;

  // Drop every copy of this id before writing the updated event once.
  await removeEventById(userId, eventId, searchDates);

  const destEvents = await loadEvents(userId, toDate);
  const destWithoutDup = destEvents.filter((e) => e.id !== eventId);
  await saveEvents(userId, toDate, [...destWithoutDup, updatedEvent]);

  return updatedEvent;
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
  eventStorageDate,
  appendEvents,
  loadEvents,
  countEvents,
  clearEvents,
  saveEvents,
  findEventOnDay,
  replaceEvent,
  deleteEventEverywhere,
  deleteStoredEvent,
  loadMonthDayTotals,
};
