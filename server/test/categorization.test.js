import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDomain,
  categorizeDomain,
  categorizeText,
  categorizeActivity,
} from '../src/services/categorizationService.js';
import { sampleDomains } from '../src/data/sampleTranscripts.js';

test('normalizeDomain strips scheme, www, and path', () => {
  assert.equal(normalizeDomain('https://www.YouTube.com/watch?v=abc'), 'youtube.com');
  assert.equal(normalizeDomain('GitHub.com'), 'github.com');
});

test('categorizeDomain matches sample domains', () => {
  for (const { domain, expected } of sampleDomains) {
    assert.equal(categorizeDomain(domain).category, expected, `domain: ${domain}`);
  }
});

test('categorizeDomain does suffix matching for subdomains', () => {
  const r = categorizeDomain('api.staging.github.com');
  assert.equal(r.category, 'work');
  assert.equal(r.method, 'domain-map');
});

test('categorizeText labels obvious activities', () => {
  assert.equal(categorizeText('debugging the backend api').category, 'work');
  assert.equal(categorizeText('took a coffee break').category, 'break');
  assert.equal(categorizeText('watched youtube videos').category, 'entertainment');
  assert.equal(categorizeText('had a standup meeting').category, 'communication');
  assert.equal(categorizeText('answered emails').category, 'communication');
  assert.equal(categorizeText('I will study tonight').category, 'learning');
  assert.equal(categorizeText('going for a run').category, 'break');
  assert.equal(categorizeText('').category, 'uncategorized');
});

test('confidence is within [0,1]', () => {
  const r = categorizeText('worked on code and reviewed a pull request');
  assert.ok(r.confidence > 0 && r.confidence <= 1);
});

test('categorizeActivity falls back to keywords without vector store', async () => {
  const r = await categorizeActivity('reading documentation', { useVector: true });
  assert.equal(r.category, 'learning');
});
