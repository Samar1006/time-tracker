// browserFilter.js — skip macOS app_focus for browsers (Chrome extension tracks domains).

const BROWSER_BUNDLE_ID_PREFIXES = [
  'com.apple.Safari',
  'com.google.Chrome',
  'com.brave.Browser',
  'org.mozilla.firefox',
  'com.microsoft.edgemac',
  'company.thebrowser.Browser',
  'com.operasoftware.Opera',
  'com.vivaldi.Vivaldi',
  'org.chromium.Chromium',
];

const BROWSER_APP_NAMES = new Set([
  'safari',
  'google chrome',
  'chrome',
  'brave browser',
  'brave',
  'firefox',
  'microsoft edge',
  'edge',
  'arc',
  'opera',
  'vivaldi',
  'chromium',
]);

function normalizeAppName(name) {
  return String(name ?? '').trim().toLowerCase();
}

export function isBrowserBundleId(bundleId) {
  if (!bundleId) return false;
  const id = String(bundleId);
  return BROWSER_BUNDLE_ID_PREFIXES.some(
    (prefix) => id === prefix || id.startsWith(`${prefix}.`),
  );
}

export function isBrowserAppName(appName) {
  return BROWSER_APP_NAMES.has(normalizeAppName(appName));
}

/** True for mac-tracker app_focus events that duplicate browser-extension domain tracking. */
export function isMacTrackerBrowserFocus(event) {
  if (!event || event.type !== 'app_focus') return false;
  if (event.metadata?.sourceClient !== 'mac-tracker') return false;
  if (isBrowserBundleId(event.metadata?.bundleId)) return true;
  return isBrowserAppName(event.app);
}
