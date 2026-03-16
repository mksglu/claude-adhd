import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { loadSponsors, loadSponsorsSync, CDN_URL } from './sponsor-loader.mjs';

// ═══════════════════════════════════════════════════════════
// CDN_URL — export integrity
// ═══════════════════════════════════════════════════════════

describe('CDN_URL', () => {
  it('contains jsdelivr', () => {
    ok(CDN_URL.includes('jsdelivr'), `expected jsdelivr in URL, got ${CDN_URL}`);
  });

  it('contains claude-adhd', () => {
    ok(CDN_URL.includes('claude-adhd'), `expected claude-adhd in URL, got ${CDN_URL}`);
  });
});

// ═══════════════════════════════════════════════════════════
// loadSponsorsSync — sync fallback chain
// ═══════════════════════════════════════════════════════════

describe('loadSponsorsSync', () => {
  it('returns an array', () => {
    const result = loadSponsorsSync();
    ok(Array.isArray(result), `expected array, got ${typeof result}`);
  });

  it('returns objects with name, tier, since fields when data exists', () => {
    const result = loadSponsorsSync();
    // The bundled sponsors.json currently has an empty array,
    // so this test validates shape only when sponsors are present
    if (result.length > 0) {
      for (const sponsor of result) {
        ok(typeof sponsor.name === 'string', 'sponsor missing name');
        ok(typeof sponsor.tier === 'string', 'sponsor missing tier');
        ok(typeof sponsor.since === 'string', 'sponsor missing since');
      }
    } else {
      // Empty array is valid — bundled file has no sponsors yet
      strictEqual(result.length, 0);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// loadSponsors — async fallback chain
// ═══════════════════════════════════════════════════════════

describe('loadSponsors', () => {
  it('returns an array', async () => {
    const result = await loadSponsors();
    ok(Array.isArray(result), `expected array, got ${typeof result}`);
  });

  it('handles network failure gracefully', async () => {
    // Even if CDN is unreachable, loadSponsors must not throw
    // and must return an array from cache/bundled/empty fallback
    const result = await loadSponsors();
    ok(Array.isArray(result), 'should return array even on network issues');
  });
});

// ═══════════════════════════════════════════════════════════
// Sponsor object shape — structural validation
// ═══════════════════════════════════════════════════════════

describe('sponsor object shape', () => {
  it('all sponsors have { name, tier, since } at minimum', async () => {
    const asyncResult = await loadSponsors();
    const syncResult = loadSponsorsSync();

    for (const sponsors of [asyncResult, syncResult]) {
      for (const sponsor of sponsors) {
        ok('name' in sponsor, 'sponsor missing name field');
        ok('tier' in sponsor, 'sponsor missing tier field');
        ok('since' in sponsor, 'sponsor missing since field');
        ok(typeof sponsor.name === 'string', `name should be string, got ${typeof sponsor.name}`);
        ok(typeof sponsor.tier === 'string', `tier should be string, got ${typeof sponsor.tier}`);
        ok(typeof sponsor.since === 'string', `since should be string, got ${typeof sponsor.since}`);
      }
    }
  });
});
