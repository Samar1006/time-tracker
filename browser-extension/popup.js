async function init() {
  const config = await chrome.storage.sync.get({
    enabled: true,
    userId: 'user-demo-1',
    apiBaseUrl: 'http://localhost:4000',
  });
  const stored = await chrome.storage.local.get('pendingEvents');
  const pendingCount = (stored.pendingEvents ?? []).length;

  const status = document.getElementById('status');
  const domain = document.getElementById('domain');
  const queue = document.getElementById('queue');

  if (!config.userId) {
    status.textContent = 'Set your User ID in extension settings.';
    status.classList.remove('status--on');
  } else if (config.enabled) {
    status.textContent = `Tracking as ${config.userId}`;
    status.classList.add('status--on');
  } else {
    status.textContent = 'Tracking paused';
    status.classList.remove('status--on');
  }

  if (pendingCount > 0) {
    queue.textContent = `${pendingCount} event(s) waiting to sync — check server is running.`;
  } else {
    queue.textContent = 'All events synced.';
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('http')) {
    try {
      domain.textContent = `Current tab: ${new URL(tab.url).hostname}`;
    } catch {
      domain.textContent = '';
    }
  } else {
    domain.textContent = 'Open a website tab to start tracking.';
  }

  document.getElementById('options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
