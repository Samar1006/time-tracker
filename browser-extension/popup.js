async function init() {
  const config = await chrome.storage.sync.get({ enabled: true, userId: '' });
  const status = document.getElementById('status');
  const domain = document.getElementById('domain');

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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('http')) {
    try {
      domain.textContent = new URL(tab.url).hostname;
    } catch {
      domain.textContent = '';
    }
  }

  document.getElementById('options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
