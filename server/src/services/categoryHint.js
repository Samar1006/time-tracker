// categoryHint.js — lightweight labels for timeline blocks until categorizationService merges.

const DOMAIN_MAP = {
  'github.com': 'work',
  'gitlab.com': 'work',
  'notion.so': 'work',
  'figma.com': 'work',
  'stackoverflow.com': 'work',
  'slack.com': 'communication',
  'gmail.com': 'communication',
  'youtube.com': 'entertainment',
  'netflix.com': 'entertainment',
  'instagram.com': 'entertainment',
  'reddit.com': 'entertainment',
};

const KEYWORD_MAP = [
  { keywords: ['gym', 'workout', 'walk', 'lunch', 'break'], category: 'break' },
  { keywords: ['code', 'debug', 'api', 'dashboard'], category: 'work' },
];

export function normalizeDomain(input) {
  if (!input) return '';
  let host = String(input).trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '');
  host = host.split('/')[0].split('?')[0].replace(/^www\./, '');
  return host;
}

export function hintCategory({ label, domain, kind }) {
  const host = normalizeDomain(domain || (kind === 'domain' ? label : ''));
  if (host && DOMAIN_MAP[host]) {
    return { category: DOMAIN_MAP[host], confidence: 1 };
  }

  const haystack = ` ${String(label).toLowerCase()} `;
  for (const row of KEYWORD_MAP) {
    if (row.keywords.some((kw) => haystack.includes(kw))) {
      return { category: row.category, confidence: 0.7 };
    }
  }

  if (/\.(com|io|org|net)$/.test(host)) return { category: 'work', confidence: 0.4 };
  return { category: 'uncategorized', confidence: 0 };
}

export default { hintCategory, normalizeDomain };
