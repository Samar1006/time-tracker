const DEFAULT_API = 'http://localhost:4000';
const DEFAULT_USER_ID = 'user-demo-1';
const MIN_DURATION_SEC = 3;
const FLUSH_ALARM = 'flush-session';
const QUEUE_KEY = 'pendingEvents';
const MAX_QUEUE = 200;

/** @type {{ url: string, domain: string | null, title: string, startedAt: number } | null} */
let currentSession = null;

function normalizeDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isTrackableUrl(url) {
  if (!url) return false;
  return !['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:'].some((p) =>
    url.startsWith(p),
  );
}

function localDateKey(ms) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getConfig() {
  return chrome.storage.sync.get({
    userId: DEFAULT_USER_ID,
    apiBaseUrl: DEFAULT_API,
    enabled: true,
  });
}

async function ensureDefaults() {
  const config = await getConfig();
  const updates = {};
  if (!config.userId) updates.userId = DEFAULT_USER_ID;
  if (!config.apiBaseUrl) updates.apiBaseUrl = DEFAULT_API;
  if (Object.keys(updates).length > 0) {
    await chrome.storage.sync.set(updates);
  }
}

function setBadge(ok) {
  if (ok) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#059669' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    return;
  }
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
}

async function postEventToApi(event, apiBaseUrl) {
  const base = (apiBaseUrl || DEFAULT_API).replace(/\/$/, '');
  const res = await fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn('[time-tracker] event rejected', res.status, body);
    return false;
  }
  return true;
}

async function enqueueEvent(event) {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] ?? [];
  queue.push({ ...event, queuedAt: Date.now() });
  if (queue.length > MAX_QUEUE) {
    queue.splice(0, queue.length - MAX_QUEUE);
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function flushQueue() {
  const { apiBaseUrl } = await getConfig();
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] ?? [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const event of queue) {
    const payload = { ...event };
    delete payload.queuedAt;
    const ok = await postEventToApi(payload, apiBaseUrl);
    if (ok) {
      console.info('[time-tracker] queued event saved', payload.domain);
    } else {
      remaining.push(event);
    }
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
  if (remaining.length === 0 && queue.length > 0) {
    setBadge(true);
  }
}

async function sendEvent(event) {
  const { apiBaseUrl } = await getConfig();
  try {
    const ok = await postEventToApi(event, apiBaseUrl);
    if (ok) {
      console.info('[time-tracker] event saved', event.domain, `${event.durationSec}s`);
      setBadge(true);
      await flushQueue();
      return true;
    }
    await enqueueEvent(event);
    setBadge(false);
    return false;
  } catch (err) {
    console.warn('[time-tracker] event failed — is the server running on port 4000?', err);
    await enqueueEvent(event);
    setBadge(false);
    return false;
  }
}

async function flushSession(reason) {
  if (!currentSession) return;

  const { userId, enabled } = await getConfig();
  if (!enabled || !userId) {
    currentSession = null;
    return;
  }

  const durationSec = Math.round((Date.now() - currentSession.startedAt) / 1000);
  const session = currentSession;
  currentSession = null;

  if (durationSec < MIN_DURATION_SEC || !session.domain) return;

  await sendEvent({
    userId,
    timestamp: new Date(session.startedAt).toISOString(),
    type: 'domain_visit',
    app: 'Chrome',
    domain: session.domain,
    title: session.title,
    durationSec,
    metadata: { source: 'browser-extension', reason, localDate: localDateKey(session.startedAt) },
  });
}

function startSession(tab) {
  if (!tab?.url || !isTrackableUrl(tab.url)) {
    currentSession = null;
    return;
  }

  const domain = normalizeDomain(tab.url);
  if (!domain) {
    currentSession = null;
    return;
  }

  currentSession = {
    url: tab.url,
    domain,
    title: tab.title || domain,
    startedAt: Date.now(),
  };
}

async function syncActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) startSession(tab);
}

async function bootstrap() {
  await ensureDefaults();
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
  await flushQueue();
  await syncActiveTab();
}

chrome.runtime.onInstalled.addListener(() => {
  bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    flushSession('interval')
      .then(() => flushQueue())
      .then(syncActiveTab);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await flushSession('tab_switch');
  try {
    const tab = await chrome.tabs.get(tabId);
    startSession(tab);
  } catch {
    currentSession = null;
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.url || changeInfo.status === 'complete') {
    await flushSession('tab_update');
    startSession(tab);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await flushSession('window_blur');
    return;
  }
  await flushSession('window_focus');
  await syncActiveTab();
});

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'idle' || state === 'locked') {
    await flushSession(`idle_${state}`);
  } else if (state === 'active') {
    await syncActiveTab();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-status') {
    Promise.all([getConfig(), chrome.storage.local.get(QUEUE_KEY)]).then(([config, stored]) => {
      sendResponse({
        enabled: config.enabled,
        userId: config.userId,
        apiBaseUrl: config.apiBaseUrl,
        pendingCount: (stored[QUEUE_KEY] ?? []).length,
        tracking: !!currentSession,
        currentDomain: currentSession?.domain ?? null,
      });
    });
    return true;
  }
  return false;
});

bootstrap();
