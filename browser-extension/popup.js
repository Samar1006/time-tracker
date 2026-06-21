async function init() {
  const config = await chrome.storage.sync.get({
    enabled: true,
    apiBaseUrl: 'http://localhost:4000',
  });
  const { authToken } = await chrome.storage.local.get('authToken');
  const stored = await chrome.storage.local.get('pendingEvents');
  const pendingCount = (stored.pendingEvents ?? []).length;

  const status = document.getElementById('status');
  const domain = document.getElementById('domain');
  const queue = document.getElementById('queue');

  if (!authToken) {
    status.textContent = 'Log in via extension settings or the dashboard.';
    status.classList.remove('status--on');
  } else if (config.enabled) {
    status.textContent = 'Tracking enabled';
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
