const USER_ID_ATTR = 'data-tracker-user-id';
const EXTENSION_ATTR = 'data-tracker-extension';

function markExtensionReady() {
  document.documentElement.setAttribute(EXTENSION_ATTR, 'ready');
}

function syncUserIdFromPage() {
  const el = document.querySelector(`[${USER_ID_ATTR}]`);
  const userId = el?.getAttribute(USER_ID_ATTR)?.trim();
  if (!userId) return;

  chrome.storage.sync.get(['userId'], (current) => {
    if (current.userId === userId) {
      markExtensionReady();
      return;
    }
    chrome.storage.sync.set({ userId, enabled: true }, () => {
      console.info('[time-tracker] synced userId from dashboard:', userId);
      markExtensionReady();
    });
  });
}

markExtensionReady();
syncUserIdFromPage();

const observer = new MutationObserver(() => {
  syncUserIdFromPage();
});
observer.observe(document.documentElement, {
  attributes: true,
  subtree: true,
  attributeFilter: [USER_ID_ATTR],
});

// Allow the dashboard page to ping extension status.
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
