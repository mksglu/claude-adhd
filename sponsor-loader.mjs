// ═══════════════════════════════════════════════════════════
// claude-adhd / sponsor-loader
// Zero-dependency sponsor loading with CDN + cache fallback
// Uses only node:https, node:fs, node:path, node:os
// ═══════════════════════════════════════════════════════════

import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Constants ───────────────────────────────────────────

export const CDN_URL = 'https://cdn.jsdelivr.net/gh/mksglu/claude-adhd@main/sponsors.json';

const CACHE_PATH = join(homedir(), '.claude-adhd-sponsors.json');
const BUNDLED_PATH = join(__dirname, 'sponsors.json');

// ── CDN Fetch ───────────────────────────────────────────

function fetchJSON(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── Cache Helpers ───────────────────────────────────────

function readCache() {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.sponsors) ? data.sponsors : [];
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(data));
  } catch {}
}

function readBundled() {
  try {
    const raw = readFileSync(BUNDLED_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.sponsors) ? data.sponsors : [];
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────

/**
 * Async sponsor loading with full fallback chain:
 * 1. CDN fetch (3s timeout)
 * 2. Local cache (~/.claude-adhd-sponsors.json)
 * 3. Bundled sponsors.json
 * 4. Empty array
 *
 * On successful CDN fetch, writes to cache.
 */
export async function loadSponsors() {
  // 1. Try CDN
  try {
    const data = await fetchJSON(CDN_URL, 3000);
    const sponsors = Array.isArray(data.sponsors) ? data.sponsors : [];
    writeCache(data);
    return sponsors;
  } catch {}

  // 2. Try cache
  const cached = readCache();
  if (cached !== null) return cached;

  // 3. Try bundled
  const bundled = readBundled();
  if (bundled !== null) return bundled;

  // 4. Empty array
  return [];
}

/**
 * Sync sponsor loading for instant startup:
 * 1. Local cache
 * 2. Bundled sponsors.json
 * 3. Empty array
 */
export function loadSponsorsSync() {
  // 1. Try cache
  const cached = readCache();
  if (cached !== null) return cached;

  // 2. Try bundled
  const bundled = readBundled();
  if (bundled !== null) return bundled;

  // 3. Empty array
  return [];
}
