const TOKEN_KEY = 'authToken';

async function load() {
  const config = await chrome.storage.sync.get({
    enabled: true,
    apiBaseUrl: 'http://localhost:4000',
    email: 'demo@timetracker.test',
  });
  document.getElementById('enabled').checked = config.enabled;
  document.getElementById('email').value = config.email;
  document.getElementById('apiBaseUrl').value = config.apiBaseUrl;

  const { authToken } = await chrome.storage.local.get(TOKEN_KEY);
  if (authToken) {
    showStatus('Logged in — token saved.', false);
  }
}

function showStatus(message, isError) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle('error', isError);
}

document.getElementById('login').addEventListener('click', async () => {
  const enabled = document.getElementById('enabled').checked;
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const apiBaseUrl = document.getElementById('apiBaseUrl').value.trim();

  await chrome.storage.sync.set({ enabled, email, apiBaseUrl });

  if (!email || !password) {
    showStatus('Enter email and password.', true);
    return;
  }

  const base = apiBaseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      showStatus(body.error || 'Login failed.', true);
      return;
    }

    await chrome.storage.local.set({ [TOKEN_KEY]: body.token });
    showStatus(`Logged in as ${body.user.email}.`, false);
  } catch {
    showStatus('Could not reach the API — check the base URL.', true);
  }
});

load();
