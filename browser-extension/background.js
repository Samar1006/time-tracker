const DEFAULT_API = 'http://localhost:4000';
const MIN_DURATION_SEC = 5;
const FLUSH_ALARM = 'flush-session';

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

async function getConfig() {
  return chrome.storage.sync.get({
    userId: '',
    apiBaseUrl: DEFAULT_API,
    enabled: true,
  });
}

async function postEvent(event) {
  const { apiBaseUrl } = await getConfig();
  const base = (apiBaseUrl || DEFAULT_API).replace(/\/$/, '');
  const res = await fetch(`${base}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn('[time-tracker] event rejected', res.status, body);
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

  await postEvent({
    userId,
    timestamp: new Date(session.startedAt).toISOString(),
    type: 'domain_visit',
    app: 'Chrome',
    domain: session.domain,
    title: session.title,
    durationSec,
    metadata: { source: 'browser-extension', reason },
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
  syncActiveTab();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    flushSession('interval').then(syncActiveTab);
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
