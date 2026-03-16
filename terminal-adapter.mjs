#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════
// claude-adhd / terminal-adapter
// Cross-platform terminal split pane adapter
// Supports: tmux, zellij, kitty, wezterm, windows terminal,
//           iterm2, apple terminal + fallback
// Zero dependencies.
// ═══════════════════════════════════════════════════════════

// ── Platform Detection ──────────────────────────────────

export function detectPlatform(platform = process.platform) {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

// ── Terminal Detection ──────────────────────────────────
// Priority: multiplexer > terminal env var > TERM_PROGRAM > fallback

export function detectTerminal(env = process.env) {
  // 1. Multiplexers (highest priority — works inside any terminal)
  if (env.TMUX) return { type: 'tmux' };
  if (env.ZELLIJ) return { type: 'zellij' };

  // 2. Terminal-specific env vars
  if (env.KITTY_WINDOW_ID) return { type: 'kitty' };
  if (env.WEZTERM_PANE) return { type: 'wezterm' };
  if (env.WT_SESSION) return { type: 'windows-terminal' };

  // 3. TERM_PROGRAM (set by most macOS/modern terminals)
  const tp = env.TERM_PROGRAM || '';
  if (tp === 'iTerm.app') return { type: 'iterm2' };
  if (tp === 'Apple_Terminal') return { type: 'apple-terminal' };
  if (tp === 'WezTerm') return { type: 'wezterm' };

  // 4. Fallback
  return { type: 'fallback' };
}

// ── Open Command ────────────────────────────────────────
// Returns the shell command to open a split pane running the game.

export function getOpenCommand(terminalType, gamePath, platform = detectPlatform(), extraArgs = []) {
  const extra = extraArgs.length ? ' ' + extraArgs.join(' ') : '';
  const cmd = `node ${gamePath}${extra}`;

  switch (terminalType) {
    case 'tmux':
      return `tmux split-window -h "${cmd}"`;

    case 'zellij':
      return `zellij run --close-on-exit -d right -- node ${gamePath}`;

    case 'kitty':
      return `kitten @ launch --location=vsplit -- node ${gamePath}`;

    case 'wezterm':
      return `wezterm cli split-pane --right -- node ${gamePath}`;

    case 'windows-terminal':
      return `wt split-pane -V -- node ${gamePath}`;

    case 'iterm2':
      return `osascript -e 'tell application "iTerm2" to tell current session of current tab of current window to set newSession to (split vertically with default profile)' -e 'tell application "iTerm2" to tell newSession to write text "${cmd}"'`;

    case 'apple-terminal':
    case 'fallback':
      if (platform === 'macos') {
        return `osascript -e 'tell app "Terminal" to do script "${cmd}"'`;
      }
      if (platform === 'windows') {
        return `start cmd /c "${cmd}"`;
      }
      // Linux fallback: try x-terminal-emulator, then xterm
      return `x-terminal-emulator -e ${cmd} || xterm -e ${cmd}`;

    default:
      return null;
  }
}

// ── Close Command ───────────────────────────────────────
// Returns the shell command to close the game pane.

export function getCloseCommand(terminalType, paneId) {
  switch (terminalType) {
    case 'tmux':
      return paneId ? `tmux kill-pane -t ${paneId}` : 'tmux kill-pane -t {right}';

    case 'zellij':
      return 'zellij action close-pane';

    case 'kitty':
      return paneId ? `kitten @ close-window --match id:${paneId}` : 'kitten @ close-window';

    case 'wezterm':
      return paneId ? `wezterm cli kill-pane --pane-id ${paneId}` : null;

    case 'windows-terminal':
      return null;

    case 'iterm2':
      return `osascript -e 'tell application "iTerm2" to tell current session of current tab of current window to close'`;

    case 'apple-terminal':
    case 'fallback':
    default:
      return null;
  }
}

// ── CLI Entry ───────────────────────────────────────────
// Only runs when executed directly (not imported for testing)

import { execSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--detect';
  const gamePath = args[1] || join(__dirname, 'flappy.mjs');

  // Pass-through extra args (e.g., --score 14) to the game
  const extraArgs = [];
  const scoreIdx = args.indexOf('--score');
  if (scoreIdx !== -1 && args[scoreIdx + 1]) {
    extraArgs.push('--score', args[scoreIdx + 1]);
  }

  const terminal = detectTerminal();
  const platform = detectPlatform();

  switch (mode) {
    case '--detect': {
      const info = { terminal: terminal.type, platform };
      console.log(JSON.stringify(info));
      break;
    }

    case '--hook-open': {
      const cmd = getOpenCommand(terminal.type, gamePath, platform, extraArgs);
      if (!cmd) {
        console.error(`No split pane support for: ${terminal.type}`);
        process.exit(1);
      }
      try {
        execSync(cmd, { stdio: 'ignore' });
      } catch (e) {
        console.error(`Failed to open game pane: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case '--hook-close': {
      const paneId = args[1] || undefined;
      const cmd = getCloseCommand(terminal.type, paneId);
      if (!cmd) {
        // No programmatic close — user closes manually
        process.exit(0);
      }
      try {
        execSync(cmd, { stdio: 'ignore' });
      } catch {
        // Pane may already be closed
      }
      break;
    }

    case '--game': {
      spawnSync('node', [gamePath], { stdio: 'inherit' });
      break;
    }

    default:
      console.log('Usage: node terminal-adapter.mjs [--detect|--hook-open|--hook-close|--game] [gamePath]');
  }
}

const isMain = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1].endsWith('terminal-adapter.mjs')
);

if (isMain) {
  main();
}
