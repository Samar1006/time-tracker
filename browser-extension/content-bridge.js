const USER_ID_ATTR = 'data-tracker-user-id';
const EXTENSION_ATTR = 'data-tracker-extension';
const TOKEN_KEY = 'authToken';
const DASHBOARD_TOKEN_KEY = 'time-tracker-token';

function markExtensionReady() {
  document.documentElement.setAttribute(EXTENSION_ATTR, 'ready');
}

function syncSessionFromPage() {
  const token = sessionStorage.getItem(DASHBOARD_TOKEN_KEY)?.trim();
  if (token) {
    chrome.storage.local.set({ [TOKEN_KEY]: token });
  }

  const el = document.querySelector(`[${USER_ID_ATTR}]`);
  const userId = el?.getAttribute(USER_ID_ATTR)?.trim();
  if (userId) {
    chrome.storage.sync.set({ enabled: true });
  }

  markExtensionReady();
}

syncSessionFromPage();

const observer = new MutationObserver(() => {
  syncSessionFromPage();
});
observer.observe(document.documentElement, {
  attributes: true,
  subtree: true,
  attributeFilter: [USER_ID_ATTR],
});

window.addEventListener('storage', (event) => {
  if (event.key === DASHBOARD_TOKEN_KEY && event.newValue) {
    chrome.storage.local.set({ [TOKEN_KEY]: event.newValue });
  }
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== 'time-tracker-ping') return;
  chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
    window.postMessage(
      {
        type: 'time-tracker-status',
        ...(response ?? { connected: false }),
        connected: !chrome.runtime.lastError,
      },
      window.location.origin,
    );
  });
});
