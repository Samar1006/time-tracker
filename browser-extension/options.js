const fields = ['enabled', 'userId', 'apiBaseUrl'];

async function load() {
  const config = await chrome.storage.sync.get({
    enabled: true,
    userId: 'user-demo-1',
    apiBaseUrl: 'http://localhost:4000',
  });
  document.getElementById('enabled').checked = config.enabled;
  document.getElementById('userId').value = config.userId;
  document.getElementById('apiBaseUrl').value = config.apiBaseUrl;
}

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    enabled: document.getElementById('enabled').checked,
    userId: document.getElementById('userId').value.trim(),
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim(),
  });
  const status = document.getElementById('status');
  status.hidden = false;
  setTimeout(() => {
    status.hidden = true;
  }, 2000);
});

load();
