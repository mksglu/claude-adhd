#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════
// claude-adhd / arcade-hooks
// Weighted signal scoring for intelligent game suggestions
// Context-mode hook pattern — reads stdin JSON, writes stdout JSON
// Zero dependencies.
// ═══════════════════════════════════════════════════════════

// ── Suppress stderr ─────────────────────────────────────
// Claude Code interprets ANY stderr output as hook failure.
process.stderr.write = /** @type {any} */ (() => true);

import { appendFileSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEBUG = process.env.ARCADE_DEBUG === '1';
const DEBUG_LOG = join(tmpdir(), 'claude-adhd-debug.log');

// ── Version ─────────────────────────────────────────────
export const VERSION = '1.0.0';

function debugLog(msg) {
  if (!DEBUG) return;
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ── Update Check ────────────────────────────────────────
// Periodic version check against CDN (max once per hour)

const UPDATE_CDN_URL = 'https://cdn.jsdelivr.net/gh/mksglu/claude-adhd@main/package.json';
const UPDATE_STATE_FILE = join(tmpdir(), 'claude-adhd-update.json');
const UPDATE_CHECK_INTERVAL = 3600000; // 1 hour in ms

/**
 * Fetch the latest version from the CDN and compare with current.
 * Returns { available: boolean, latest: string, current: string } or null on error.
 * Zero dependencies — uses node:https only.
 */
export function checkForUpdate(currentVersion = VERSION) {
  return new Promise((resolve) => {
    const req = https.get(UPDATE_CDN_URL, { timeout: 3000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const remote = JSON.parse(data);
          const latest = remote.version ?? null;
          if (!latest) return resolve(null);
          const available = latest !== currentVersion && isNewerVersion(latest, currentVersion);
          resolve({ available, latest, current: currentVersion });
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

/**
 * Simple semver comparison: returns true if a > b.
 * Handles x.y.z format only.
 */
function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Runs the update check if enough time has passed since the last check.
 * Saves result to a temp file for PreToolUse to read.
 */
async function periodicUpdateCheck() {
  try {
    // Check if we already checked recently
    if (existsSync(UPDATE_STATE_FILE)) {
      const state = JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf-8'));
      if (Date.now() - (state.ts || 0) < UPDATE_CHECK_INTERVAL) {
        return; // Too soon, skip
      }
    }
  } catch {
    // Corrupted state file — proceed with check
  }

  const result = await checkForUpdate();
  if (result) {
    try {
      writeFileSync(UPDATE_STATE_FILE, JSON.stringify({
        ...result,
        ts: Date.now(),
        notified: false,
      }));
    } catch {}
  }
}

/**
 * Reads the update state file. If an update is available and not yet notified,
 * marks it as notified and returns the update info. Otherwise returns null.
 */
function consumeUpdateNotification() {
  try {
    if (!existsSync(UPDATE_STATE_FILE)) return null;
    const state = JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf-8'));
    if (state.available && !state.notified) {
      // Mark as notified so we only show it once
      writeFileSync(UPDATE_STATE_FILE, JSON.stringify({ ...state, notified: true }));
      return state;
    }
  } catch {}
  return null;
}

// ── Signal Registry ─────────────────────────────────────
// Each signal: { id, weight, test(input) → boolean }
// Score = Σ(weight) for all matching signals

export const SIGNALS = {
  prompt: [
    {
      id: 'extended-thinking',
      weight: 5,
      test: (text) => /ultrathink|think\s*(deeply|hard|step\s*by\s*step)|deep\s*think/i.test(text),
    },
    {
      id: 'high-reasoning-effort',
      weight: 3,
      test: (text) => /reasoning\s*effort\s*level:\s*high/i.test(text),
    },
    {
      id: 'parallel-work',
      weight: 3,
      test: (text) => /parallel|concurrent|simultaneous/i.test(text),
    },
    {
      id: 'agent-mention',
      weight: 3,
      test: (text) => /\bagents?\b|subagent/i.test(text),
    },
    {
      id: 'architecture',
      weight: 3,
      test: (text) => /refactor|migrat(e|ion)|rewrite|architect/i.test(text),
    },
    {
      id: 'broad-scope',
      weight: 2,
      test: (text) => /\ball\s+files\b|\bentire\b|\bevery\b|\bcodebase\b/i.test(text),
    },
    {
      id: 'multi-step',
      weight: 2,
      test: (text) => /\bplan\b.*\b(design|implement|build)\b|\bdesign\b.*\bimplement\b/i.test(text),
    },
    {
      id: 'tdd',
      weight: 3,
      test: (text) => /\btdd\b|test.driven|red.green/i.test(text),
    },
    {
      id: 'code-blocks',
      weight: 2,
      test: (text) => (text.match(/```/g) || []).length >= 4,
    },
    {
      id: 'long-prompt',
      weight: 2,
      test: (text) => text.length > 500,
    },
    {
      id: 'very-long-prompt',
      weight: 3,
      test: (text) => text.length > 1500,
    },
  ],

  tool: [
    {
      id: 'tool-agent',
      weight: 4,
      test: (name, _input) => name === 'Agent',
    },
    {
      id: 'tool-agent-background',
      weight: 1,
      test: (name, input) => name === 'Agent' && input?.run_in_background === true,
    },
    {
      id: 'tool-bash-build',
      weight: 3,
      test: (name, input) => name === 'Bash' && /\b(build|compile|bundle|webpack|vite|esbuild|tsc)\b/i.test(input?.command || ''),
    },
    {
      id: 'tool-bash-test',
      weight: 2,
      test: (name, input) => name === 'Bash' && /\b(test|jest|vitest|mocha|pytest|cargo\s+test)\b/i.test(input?.command || ''),
    },
    {
      id: 'tool-bash-install',
      weight: 2,
      test: (name, input) => name === 'Bash' && /\b(npm\s+install|pnpm\s+install|yarn\s+add|pip\s+install|cargo\s+add)\b/i.test(input?.command || ''),
    },
  ],
};

// ── Default Config ──────────────────────────────────────

export const DEFAULT_CONFIG = {
  suggestThreshold: 5,
};

// ── Score Functions ─────────────────────────────────────

export function scorePrompt(text) {
  const signals = [];
  let score = 0;

  for (const sig of SIGNALS.prompt) {
    if (sig.test(text)) {
      signals.push(sig.id);
      score += sig.weight;
    }
  }

  return { score, signals };
}

export function scoreTool(toolName, toolInput) {
  const signals = [];
  let score = 0;

  for (const sig of SIGNALS.tool) {
    if (sig.test(toolName, toolInput)) {
      signals.push(sig.id);
      score += sig.weight;
    }
  }

  return { score, signals };
}

// ── Decision Function ───────────────────────────────────

export function shouldSuggestGame(score, config = DEFAULT_CONFIG) {
  const threshold = config.suggestThreshold ?? DEFAULT_CONFIG.suggestThreshold;

  if (score >= threshold) {
    return {
      action: 'suggest',
      reason: `Score ${score} >= threshold ${threshold}`,
    };
  }

  return {
    action: 'none',
    reason: `Score ${score} < threshold ${threshold}`,
  };
}

// ── Affirmation Detection ───────────────────────────────
// Detects short affirmative messages (for /btw responses)

export function isGameAffirmation(text) {
  const t = (text || '').toLowerCase().trim();
  return /^(aç|ac|evet|yes|ok|okay|sure|open|play|game|oui|ja|sí|はい|si|yep|yup|go|let's go|hadi|tamam)$/i.test(t);
}

// ── Context Builder ─────────────────────────────────────

export function buildSuggestionContext(scoreResult, adapterPath, gamePath, alreadyOpen = false) {
  const { score, signals } = scoreResult;
  const closeCmd = `node ${adapterPath} --hook-close`;

  if (alreadyOpen) {
    return `<arcade-notification score="${score}" status="already-open">Flappy Bird is already running. In your FIRST response, write ONE casual sentence in the user's language mentioning the task complexity (score: ${score}) and that the game is already open. Example: "Big task ahead (complexity: ${score}), good thing Flappy Bird is already open 🎮". Then CONTINUE working. When ALL work is complete, run: ${closeCmd}</arcade-notification>`;
  }

  return `<arcade-notification score="${score}" status="just-opened">Flappy Bird was auto-opened. In your FIRST response, write ONE casual sentence in the user's language mentioning the task complexity (score: ${score}) and that Flappy Bird was opened for them. Example: "This will take some work (complexity: ${score}), opened Flappy Bird so you're not staring at a spinner 🎮". Then CONTINUE working. When ALL work is complete, run: ${closeCmd}</arcade-notification>`;
}

// ── Hook Handlers ───────────────────────────────────────

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

// ── Process Detection ────────────────────────────────────
// Check if the game is ACTUALLY running — survives session restarts

export function isGameProcessRunning(gameName = 'flappy.mjs') {
  try {
    const result = execSync(
      process.platform === 'win32'
        ? `tasklist /FI "IMAGENAME eq node.exe" /FO CSV`
        : `pgrep -f "${gameName}"`,
      { encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return result.trim().length > 0;
  } catch {
    return false; // pgrep exits 1 when no match
  }
}

// ── Game State Management ───────────────────────────────
// Tracks: pending (suggestion shown), opened (game running)

const GAME_STATE_FILE = join(tmpdir(), 'claude-adhd-game-state.json');

function saveGameState(state) {
  try {
    writeFileSync(GAME_STATE_FILE, JSON.stringify({ ...state, ts: Date.now() }));
  } catch {}
}

export function loadGameState() {
  try {
    const data = JSON.parse(readFileSync(GAME_STATE_FILE, 'utf-8'));
    // Expire after 5 minutes
    if (Date.now() - data.ts > 300000) {
      try { unlinkSync(GAME_STATE_FILE); } catch {}
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearGameState() {
  try { unlinkSync(GAME_STATE_FILE); } catch {}
}

// ── Prompt Score State ──────────────────────────────────

const SCORE_STATE_FILE = join(tmpdir(), 'claude-adhd-score.json');

function savePromptScore(result) {
  try {
    writeFileSync(SCORE_STATE_FILE, JSON.stringify({ ...result, ts: Date.now() }));
  } catch {}
}

function loadPromptScore() {
  try {
    const data = JSON.parse(readFileSync(SCORE_STATE_FILE, 'utf-8'));
    if (Date.now() - data.ts > 60000) return null;
    // Consume: delete after reading so we don't suggest twice
    try { unlinkSync(SCORE_STATE_FILE); } catch {}
    return data;
  } catch {
    return null;
  }
}

// ── UPS Handler ─────────────────────────────────────────

async function handleUserPromptSubmit() {
  debugLog('handleUserPromptSubmit: start');
  const raw = await readStdin();
  const input = JSON.parse(raw);
  const prompt = (input.prompt ?? input.message ?? '').trim();
  debugLog(`handleUserPromptSubmit: prompt="${prompt.slice(0, 80)}"`);

  // 1. Check for game affirmation (/btw or regular message)
  const gameState = loadGameState();
  if (gameState?.pending && !gameState?.opened && isGameAffirmation(prompt)) {
    debugLog('handleUserPromptSubmit: affirmation detected, opening game directly');
    const adapterPath = join(__dirname, 'terminal-adapter.mjs');
    const gamePath = gameState.gamePath || join(__dirname, 'flappy.mjs');
    try {
      execSync(`node "${adapterPath}" --hook-open "${gamePath}"`, {
        stdio: 'ignore',
        timeout: 5000,
      });
      saveGameState({ ...gameState, pending: false, opened: true });
      debugLog('handleUserPromptSubmit: game opened successfully');
    } catch (e) {
      debugLog(`handleUserPromptSubmit: failed to open game: ${e?.message}`);
    }
    return; // Don't score affirmation prompts
  }

  // 2. Normal scoring for complex prompts
  const result = scorePrompt(prompt);
  debugLog(`handleUserPromptSubmit: score=${result.score} signals=${result.signals.join(',')}`);

  // UPS must be SILENT — no stdout output.
  if (result.score > 0) {
    savePromptScore(result);
  }

  // 3. If high enough, mark pending — PreToolUse will open + notify
  const decision = shouldSuggestGame(result.score);
  if (decision.action === 'suggest') {
    const gamePath = join(__dirname, 'flappy.mjs');
    const alreadyRunning = isGameProcessRunning();
    saveGameState({
      pending: !alreadyRunning,
      opened: alreadyRunning,
      gamePath,
    });
    debugLog(`handleUserPromptSubmit: ${alreadyRunning ? 'game already running' : 'pending for PreToolUse'}`);
  }

  // 4. Periodic update check (non-blocking, max once per hour)
  periodicUpdateCheck().catch(() => {});

  debugLog('handleUserPromptSubmit: done (silent)');
}

// ── PreToolUse Handler ──────────────────────────────────

async function handlePreToolUse() {
  debugLog('handlePreToolUse: start');
  const raw = await readStdin();
  const input = JSON.parse(raw);
  const toolName = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};

  // 1. Score this tool call
  const toolResult = scoreTool(toolName, toolInput);

  // 2. Check if UPS saved a high prompt score
  const promptResult = loadPromptScore();

  // 3. Combine: prompt score + tool score
  const combinedScore = (promptResult?.score || 0) + toolResult.score;
  const combinedSignals = [...(promptResult?.signals || []), ...toolResult.signals];

  debugLog(`handlePreToolUse: tool=${toolName} toolScore=${toolResult.score} promptScore=${promptResult?.score || 0} combined=${combinedScore}`);

  // 4. Open game + notify Claude (both in same hook call — this is the pattern that works)
  const gameState = loadGameState();
  const adapterPath = join(__dirname, 'terminal-adapter.mjs');
  const gamePath = (gameState?.gamePath) || join(__dirname, 'flappy.mjs');
  const combined = { score: combinedScore, signals: combinedSignals };
  const processRunning = isGameProcessRunning();

  if (combinedScore >= DEFAULT_CONFIG.suggestThreshold) {
    let alreadyOpen = processRunning;

    // Open game if not running
    if (!processRunning && gameState?.pending) {
      try {
        execSync(`node "${adapterPath}" --hook-open "${gamePath}"`, { stdio: 'ignore', timeout: 5000 });
        saveGameState({ pending: false, opened: true, gamePath });
        debugLog(`handlePreToolUse: game opened (score=${combinedScore})`);
        alreadyOpen = false;
      } catch (e) {
        debugLog(`handlePreToolUse: failed to open: ${e?.message}`);
      }
    }

    // Notify Claude
    const ctx = buildSuggestionContext(combined, adapterPath, gamePath, alreadyOpen);
    process.stdout.write(JSON.stringify({ decision: 'allow', additionalContext: ctx }) + '\n');
    debugLog(`handlePreToolUse: notification sent (alreadyOpen=${alreadyOpen})`);
  }

  debugLog('handlePreToolUse: done');
}

// ── Upgrade Handler ─────────────────────────────────────

function handleUpgrade() {
  console.log(`claude-adhd upgrade (current: v${VERSION})`);
  console.log('Pulling latest from origin main...\n');

  try {
    const result = execSync('git pull origin main', {
      cwd: __dirname,
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log(result.trim());

    // Re-read package.json for the new version
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
      console.log(`\nUpgraded to v${pkg.version}`);
    } catch {
      console.log('\nUpgrade complete.');
    }

    // Clear the update state so we don't keep notifying
    try { unlinkSync(UPDATE_STATE_FILE); } catch {}
  } catch (err) {
    console.error(`Upgrade failed: ${err?.message || err}`);
    process.exit(1);
  }
}

// ── CLI Entry ───────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1].endsWith('arcade-hooks.mjs')
);

if (isMain) {
  const mode = process.argv[2];
  debugLog(`CLI entry: mode=${mode} argv=${JSON.stringify(process.argv)}`);

  try {
    switch (mode) {
      case '--user-prompt-submit':
        await handleUserPromptSubmit();
        break;
      case '--pre-tool-use':
        await handlePreToolUse();
        break;
      case '--upgrade':
        handleUpgrade();
        break;
      case '--version':
        console.log(VERSION);
        break;
      default:
        debugLog(`Unknown mode: ${mode}`);
    }
  } catch (err) {
    debugLog(`CAUGHT ERROR: ${err?.message}\n${err?.stack}`);
  }
}
