import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import {
  detectPlatform,
  detectTerminal,
  getOpenCommand,
  getCloseCommand,
} from './terminal-adapter.mjs';

// ═══════════════════════════════════════════════════════════
// detectPlatform
// ═══════════════════════════════════════════════════════════

describe('detectPlatform', () => {
  it('returns macos for darwin', () => {
    strictEqual(detectPlatform('darwin'), 'macos');
  });

  it('returns windows for win32', () => {
    strictEqual(detectPlatform('win32'), 'windows');
  });

  it('returns linux for linux', () => {
    strictEqual(detectPlatform('linux'), 'linux');
  });

  it('returns linux for unknown platforms', () => {
    strictEqual(detectPlatform('freebsd'), 'linux');
    strictEqual(detectPlatform('sunos'), 'linux');
  });
});

// ═══════════════════════════════════════════════════════════
// detectTerminal — individual terminals
// ═══════════════════════════════════════════════════════════

describe('detectTerminal', () => {
  it('detects tmux from $TMUX', () => {
    deepStrictEqual(detectTerminal({ TMUX: '/tmp/tmux-501/default,12345,0' }), { type: 'tmux' });
  });

  it('detects zellij from $ZELLIJ', () => {
    deepStrictEqual(detectTerminal({ ZELLIJ: '0' }), { type: 'zellij' });
  });

  it('detects kitty from $KITTY_WINDOW_ID', () => {
    deepStrictEqual(detectTerminal({ KITTY_WINDOW_ID: '1' }), { type: 'kitty' });
  });

  it('detects wezterm from $WEZTERM_PANE', () => {
    deepStrictEqual(detectTerminal({ WEZTERM_PANE: '0' }), { type: 'wezterm' });
  });

  it('detects wezterm from $TERM_PROGRAM=WezTerm when $WEZTERM_PANE missing', () => {
    deepStrictEqual(detectTerminal({ TERM_PROGRAM: 'WezTerm' }), { type: 'wezterm' });
  });

  it('detects windows terminal from $WT_SESSION', () => {
    deepStrictEqual(detectTerminal({ WT_SESSION: '{guid}' }), { type: 'windows-terminal' });
  });

  it('detects iterm2 from $TERM_PROGRAM', () => {
    deepStrictEqual(detectTerminal({ TERM_PROGRAM: 'iTerm.app' }), { type: 'iterm2' });
  });

  it('detects apple terminal from $TERM_PROGRAM', () => {
    deepStrictEqual(detectTerminal({ TERM_PROGRAM: 'Apple_Terminal' }), { type: 'apple-terminal' });
  });

  it('returns fallback when nothing matches', () => {
    deepStrictEqual(detectTerminal({}), { type: 'fallback' });
  });

  it('returns fallback for unknown TERM_PROGRAM', () => {
    deepStrictEqual(detectTerminal({ TERM_PROGRAM: 'SomeRandomTerminal' }), { type: 'fallback' });
  });
});

// ═══════════════════════════════════════════════════════════
// detectTerminal — priority: multiplexer > terminal > fallback
// ═══════════════════════════════════════════════════════════

describe('detectTerminal priority', () => {
  it('tmux wins over iterm2', () => {
    deepStrictEqual(
      detectTerminal({ TMUX: '1', TERM_PROGRAM: 'iTerm.app' }),
      { type: 'tmux' },
    );
  });

  it('tmux wins over kitty', () => {
    deepStrictEqual(
      detectTerminal({ TMUX: '1', KITTY_WINDOW_ID: '1' }),
      { type: 'tmux' },
    );
  });

  it('zellij wins over wezterm', () => {
    deepStrictEqual(
      detectTerminal({ ZELLIJ: '0', WEZTERM_PANE: '0' }),
      { type: 'zellij' },
    );
  });

  it('multiplexer wins over any terminal-specific', () => {
    deepStrictEqual(
      detectTerminal({ TMUX: '1', ZELLIJ: '0', KITTY_WINDOW_ID: '1', WEZTERM_PANE: '0', WT_SESSION: '{g}', TERM_PROGRAM: 'iTerm.app' }),
      { type: 'tmux' },
    );
  });

  it('kitty wins over TERM_PROGRAM iterm2 (env var > TERM_PROGRAM)', () => {
    deepStrictEqual(
      detectTerminal({ KITTY_WINDOW_ID: '1', TERM_PROGRAM: 'iTerm.app' }),
      { type: 'kitty' },
    );
  });

  it('wezterm env var wins over WT_SESSION', () => {
    deepStrictEqual(
      detectTerminal({ WEZTERM_PANE: '0', WT_SESSION: '{g}' }),
      { type: 'wezterm' },
    );
  });
});

// ═══════════════════════════════════════════════════════════
// getOpenCommand
// ═══════════════════════════════════════════════════════════

describe('getOpenCommand', () => {
  const game = '/path/to/flappy.mjs';

  it('tmux: split-window horizontal', () => {
    const cmd = getOpenCommand('tmux', game);
    strictEqual(cmd, `tmux split-window -h "node ${game}"`);
  });

  it('zellij: run with direction right', () => {
    const cmd = getOpenCommand('zellij', game);
    strictEqual(cmd, `zellij run --close-on-exit -d right -- node ${game}`);
  });

  it('kitty: launch vsplit', () => {
    const cmd = getOpenCommand('kitty', game);
    strictEqual(cmd, `kitten @ launch --location=vsplit -- node ${game}`);
  });

  it('wezterm: split-pane right', () => {
    const cmd = getOpenCommand('wezterm', game);
    strictEqual(cmd, `wezterm cli split-pane --right -- node ${game}`);
  });

  it('windows-terminal: wt split-pane vertical', () => {
    const cmd = getOpenCommand('windows-terminal', game);
    strictEqual(cmd, `wt split-pane -V -- node ${game}`);
  });

  it('iterm2: osascript split + write', () => {
    const cmd = getOpenCommand('iterm2', game);
    // Must contain osascript, split vertically, and the game command
    strictEqual(cmd.includes('osascript'), true);
    strictEqual(cmd.includes('split vertically'), true);
    strictEqual(cmd.includes(`node ${game}`), true);
  });

  it('apple-terminal on macos: new terminal window via osascript', () => {
    const cmd = getOpenCommand('apple-terminal', game, 'macos');
    strictEqual(cmd.includes('osascript'), true);
    strictEqual(cmd.includes(`node ${game}`), true);
  });

  it('fallback on macos: osascript new terminal window', () => {
    const cmd = getOpenCommand('fallback', game, 'macos');
    strictEqual(cmd.includes('osascript'), true);
  });

  it('fallback on linux: x-terminal-emulator', () => {
    const cmd = getOpenCommand('fallback', game, 'linux');
    strictEqual(cmd.includes('x-terminal-emulator'), true);
  });

  it('fallback on windows: start cmd', () => {
    const cmd = getOpenCommand('fallback', game, 'windows');
    strictEqual(cmd.includes('start cmd'), true);
  });
});

// ═══════════════════════════════════════════════════════════
// getCloseCommand
// ═══════════════════════════════════════════════════════════

describe('getCloseCommand', () => {
  it('tmux: kill-pane with target', () => {
    strictEqual(getCloseCommand('tmux', '3'), 'tmux kill-pane -t 3');
  });

  it('tmux: kill right pane when no paneId', () => {
    const cmd = getCloseCommand('tmux');
    strictEqual(cmd, 'tmux kill-pane -t {right}');
  });

  it('zellij: close-pane', () => {
    strictEqual(getCloseCommand('zellij'), 'zellij action close-pane');
  });

  it('kitty: close-window with match', () => {
    strictEqual(getCloseCommand('kitty', '42'), 'kitten @ close-window --match id:42');
  });

  it('kitty: close-window without id', () => {
    strictEqual(getCloseCommand('kitty'), 'kitten @ close-window');
  });

  it('wezterm: kill-pane with id', () => {
    strictEqual(getCloseCommand('wezterm', '5'), 'wezterm cli kill-pane --pane-id 5');
  });

  it('wezterm: null without id', () => {
    strictEqual(getCloseCommand('wezterm'), null);
  });

  it('windows-terminal: null (no programmatic close)', () => {
    strictEqual(getCloseCommand('windows-terminal'), null);
  });

  it('iterm2: osascript close', () => {
    const cmd = getCloseCommand('iterm2');
    strictEqual(cmd.includes('osascript'), true);
    strictEqual(cmd.includes('close'), true);
  });

  it('apple-terminal: null', () => {
    strictEqual(getCloseCommand('apple-terminal'), null);
  });

  it('fallback: null', () => {
    strictEqual(getCloseCommand('fallback'), null);
  });
});
