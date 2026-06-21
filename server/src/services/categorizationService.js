// categorizationService.js
// Auto-labels an activity (free text) or a domain name into a category.
//
// Strategy, cheapest first:
//   1. Domain map        — exact known domains (github.com -> work)
//   2. Keyword matching   — scores category keyword hits in the text
//   3. Vector similarity  — OPTIONAL, via Redis. Disabled & gracefully
//                           skipped if REDIS_URL is unset or unreachable,
//                           so everything below works fully offline.

export const CATEGORIES = {
  work: {
    keywords: ['work', 'coding', 'code', 'develop', 'debug', 'api', 'backend',
      'frontend', 'deploy', 'pull request', 'pr ', 'review', 'dashboard',
      'jira', 'ticket', 'sprint', 'design', 'spec', 'build', 'refactor'],
    domains: ['github.com', 'gitlab.com', 'jira.com', 'atlassian.net', 'figma.com',
      'notion.so', 'stackoverflow.com', 'localhost'],
  },
  communication: {
    keywords: ['email', 'emails', 'slack', 'message', 'call', 'zoom', 'chat', 'reply',
      'replied', 'inbox', 'standup', 'stand-up', 'stand up', 'sync', 'huddle',
      'meeting', '1:1', 'one on one', 'teams call', 'answered emails'],
    domains: ['gmail.com', 'mail.google.com', 'slack.com', 'zoom.us', 'outlook.com',
      'teams.microsoft.com'],
  },
  learning: {
    keywords: ['read', 'reading', 'learn', 'learning', 'course', 'tutorial',
      'documentation', 'docs', 'study', 'research', 'article'],
    domains: ['coursera.org', 'udemy.com', 'wikipedia.org', 'medium.com',
      'developer.mozilla.org', 'arxiv.org'],
  },
  entertainment: {
    keywords: ['youtube', 'netflix', 'watch', 'video', 'game', 'gaming', 'music',
      'browse', 'browsing', 'scroll', 'social media', 'twitter', 'reddit'],
    domains: ['youtube.com', 'netflix.com', 'twitch.tv', 'reddit.com', 'twitter.com',
      'x.com', 'instagram.com', 'tiktok.com', 'spotify.com'],
  },
  break: {
    keywords: ['break', 'lunch', 'coffee', 'rest', 'walk', 'snack', 'nap', 'relax',
      'workout', 'work out', 'running', 'jogging', 'exercise'],
    domains: [],
  },
};

const UNKNOWN = { category: 'uncategorized', confidence: 0, method: 'none', matched: [] };

// Strong phrase matches beat generic keyword overlap (e.g. study vs break).
const PHRASE_RULES = [
  [/\bcoffee\s+break\b/, 'break'],
  [/\blunch\s+break\b/, 'break'],
  [/\b(?:study|studying|homework|revision)\b/, 'learning'],
  [/\b(?:run|running|jog|jogging)\b/, 'break'],
  [/\b(?:workout|gym)\b/, 'break'],
  [/\b(?:standup|stand-up|stand up)\b/, 'communication'],
  [/\b(?:answered\s+)?emails?\b/, 'communication'],
  [/\b(?:youtube|netflix|reddit)\b/, 'entertainment'],
];

function keywordMatches(haystack, kw) {
  if (kw.includes(' ')) return haystack.includes(kw);
  return haystack.includes(` ${kw.trim()} `);
}

// Normalize "https://www.YouTube.com/watch?v=.." -> "youtube.com"
export function normalizeDomain(input) {
  if (!input) return '';
  let host = String(input).trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, ''); // strip scheme
  host = host.split('/')[0]; // strip path
  host = host.split('?')[0];
  host = host.replace(/^www\./, '');
  return host;
}

// Categorize a domain name. Exact match first, then suffix match
// (sub.github.com -> github.com), then keyword fallback on the host string.
export function categorizeDomain(input) {
  const host = normalizeDomain(input);
  if (!host) return { ...UNKNOWN };

  for (const [category, cfg] of Object.entries(CATEGORIES)) {
    for (const d of cfg.domains) {
      if (host === d || host.endsWith('.' + d)) {
        return { category, confidence: 1, method: 'domain-map', matched: [d] };
      }
    }
  }
  // Fall back to treating the host like text ("mycompany-jira" -> work)
  const byKeyword = categorizeText(host);
  return byKeyword.confidence > 0
    ? { ...byKeyword, method: 'domain-keyword' }
    : { ...UNKNOWN };
}

// Categorize free-text activity by keyword hit count. Confidence is the
// winning category's share of total keyword hits, lightly scaled.
export function categorizeText(text) {
  if (!text || !text.trim()) return { ...UNKNOWN };
  const haystack = ' ' + text.toLowerCase() + ' ';

  if (/\band\b/.test(haystack)) {
    const parts = text.split(/\band\b/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const results = parts.map((p) => categorizeText(p));
      const ranked = results.filter((r) => r.category !== 'uncategorized');
      if (ranked.length) return ranked[ranked.length - 1];
    }
  }

  for (const [pattern, category] of PHRASE_RULES) {
    if (pattern.test(haystack)) {
      return {
        category,
        confidence: 0.9,
        method: 'phrase',
        matched: [String(pattern)],
      };
    }
  }

  const scores = {};
  const hits = {};
  let total = 0;
  for (const [category, cfg] of Object.entries(CATEGORIES)) {
    hits[category] = [];
    for (const kw of cfg.keywords) {
      if (keywordMatches(haystack, kw)) {
        scores[category] = (scores[category] || 0) + kw.length;
        hits[category].push(kw);
        total += kw.length;
      }
    }
  }

  if (total === 0) return { ...UNKNOWN };

  let best = null;
  for (const [category, score] of Object.entries(scores)) {
    if (!best || score > scores[best]) best = category;
  }
  return {
    category: best,
    confidence: Math.min(1, scores[best] / total + 0.15),
    method: 'keyword',
    matched: hits[best],
  };
}

// ---------------------------------------------------------------------------
// OPTIONAL Redis vector similarity. Self-contained and lazy: if `redis` isn't
// installed, REDIS_URL is unset, or the connection fails, this no-ops and the
// caller keeps the keyword result. Wire real embeddings here if you go this
// route — the seam is intentionally small.
// ---------------------------------------------------------------------------
let _redis = null;
let _redisTried = false;

async function getRedis() {
  if (_redisTried) return _redis;
  _redisTried = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const { createClient } = await import('redis');
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', () => {}); // swallow — we degrade to keyword
    await client.connect();
    _redis = client;
  } catch {
    _redis = null;
  }
  return _redis;
}

// Public entry point. Tries vector similarity only if explicitly enabled and
// available; otherwise returns the keyword result. Always resolves.
export async function categorizeActivity(text, { useVector = false } = {}) {
  const keywordResult = categorizeText(text);
  if (!useVector) return keywordResult;

  const redis = await getRedis();
  if (!redis) return keywordResult; // graceful fallback

  // Placeholder for a real KNN query against a RediSearch vector index.
  // Left as a seam so tests don't require a running Redis. Until embeddings
  // are wired up, defer to keywords.
  return keywordResult;
}

export default {
  CATEGORIES,
  normalizeDomain,
  categorizeDomain,
  categorizeText,
  categorizeActivity,
};
