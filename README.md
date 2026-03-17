# claude-adhd

**A terminal Flappy Bird that auto-opens when Claude Code detects complex tasks.**

[![npm version](https://img.shields.io/npm/v/claude-adhd)](https://www.npmjs.com/package/claude-adhd)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-108%20passing-brightgreen)](#development)

<div align="center">

https://github.com/user-attachments/assets/1cdd9d53-95f6-434e-809f-9bbcaf4fd383

</div>

---

## How it works

When Claude Code starts working on something complex, `claude-adhd` automatically opens Flappy Bird in a split pane so you have something to do while waiting.

```
┌─────────────────────────┬────────────────────┐
│ Claude Code             │  ~~ FLAPPY BIRD ~~ │
│                         │                    │
│ Analyzing codebase...   │   Score: 7         │
│ Reading 42 files...     │                    │
│ Refactoring auth...     │      \o)      ██   │
│                         │              ██   │
│                         │              ██   │
│ > Writing changes...    │                    │
└─────────────────────────┴────────────────────┘
```

The hook system scores every prompt and tool call using weighted signals. When the complexity score crosses the threshold, the game opens automatically in a terminal split pane. When Claude finishes the task, it closes the game pane.

---

## When does it trigger?

`claude-adhd` uses a weighted signal scoring algorithm. Each prompt and tool call is evaluated against a set of signals. If the combined score meets or exceeds the threshold (**default: 5**), the game opens.

### Prompt signals

| Signal | Weight | Matches |
|---|---:|---|
| `extended-thinking` | 5 | "ultrathink", "think deeply", "think hard", "deep think" |
| `high-reasoning-effort` | 3 | "reasoning effort level: high" |
| `parallel-work` | 3 | "parallel", "concurrent", "simultaneous" |
| `agent-mention` | 3 | "agent", "agents", "subagent" |
| `architecture` | 3 | "refactor", "migrate", "rewrite", "architect" |
| `tdd` | 3 | "tdd", "test-driven", "red-green" |
| `very-long-prompt` | 3 | Prompt > 1500 characters |
| `broad-scope` | 2 | "all files", "entire", "every", "codebase" |
| `multi-step` | 2 | "plan ... design/implement/build" patterns |
| `code-blocks` | 2 | 4+ code fences in prompt |
| `long-prompt` | 2 | Prompt > 500 characters |

### Tool signals

| Signal | Weight | Matches |
|---|---:|---|
| `tool-agent` | 4 | Agent tool invocation |
| `tool-bash-build` | 3 | Bash: build, compile, bundle, webpack, vite, tsc |
| `tool-bash-test` | 2 | Bash: test, jest, vitest, mocha, pytest |
| `tool-bash-install` | 2 | Bash: npm install, pip install, cargo add |
| `tool-agent-background` | 1 | Agent running in background |

### Examples

| Prompt | Signals matched | Score | Result |
|---|---|---:|---|
| "ultrathink, refactor the auth module" | extended-thinking + architecture | **8** | Triggers |
| "run parallel agents to analyze the codebase with TDD" | parallel-work + agent-mention + broad-scope + tdd | **12** | Triggers |
| "fix the typo in readme" | *(none)* | **0** | No trigger |
| "rename this variable" | *(none)* | **0** | No trigger |

If the game is already running (detected via `pgrep`), it won't open another instance -- instead it tells Claude the game is already open.

---

## Installation

### Claude Code Plugin (Recommended)

1. Add the marketplace:
```
/plugin marketplace add mksglu/claude-adhd
```

2. Install the plugin:
```
/plugin install claude-adhd@mksglu
```

This auto-registers hooks via `${CLAUDE_PLUGIN_ROOT}`. Restart Claude Code after install.

### Manual Installation

1. Clone the repo:

```bash
git clone https://github.com/mksglu/claude-adhd.git ~/.claude-adhd
```

2. Add hooks to `~/.claude/settings.json`. If you already have hooks (e.g., from context-mode), merge the entries into your existing arrays:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude-adhd/arcade-hooks.mjs --user-prompt-submit"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Agent|Task",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude-adhd/arcade-hooks.mjs --pre-tool-use"
          }
        ]
      }
    ]
  }
}
```

> **Note:** If you use other plugins with PreToolUse hooks (like context-mode), add the claude-adhd hook as a second entry in the same `hooks` array — not as a separate matcher entry. This ensures both hooks fire for the same tool call:
>
> ```json
> {
>   "matcher": "Bash|Agent|Task",
>   "hooks": [
>     { "type": "command", "command": "node /path/to/other-plugin/hook.mjs" },
>     { "type": "command", "command": "node ~/.claude-adhd/arcade-hooks.mjs --pre-tool-use" }
>   ]
> }
> ```

3. Restart Claude Code.

---

## Supported terminals

The game opens in a **split pane** when your terminal supports it, or falls back to a new window.

| Terminal | Split method | Platform |
|---|---|---|
| **tmux** | `tmux split-window -h` | Any |
| **Zellij** | `zellij run -d right` | Any |
| **Kitty** | `kitten @ launch --location=vsplit` | Any |
| **WezTerm** | `wezterm cli split-pane --right` | Any |
| **Windows Terminal** | `wt split-pane -V` | Windows |
| **iTerm2** | AppleScript split vertically | macOS |
| **Fallback** | New terminal window | macOS / Linux / Windows |

Detection priority: multiplexer env vars > terminal-specific env vars > `TERM_PROGRAM` > fallback.

---

## Sponsorship

Sponsors are displayed on the Flappy Bird start screen with clickable links (in supported terminals).

### Tiers

| Tier | Display | What you get |
|---|---|---|
| **Gold** | `★ Name` in yellow bold + tagline | Top of the list, bold highlight, tagline |
| **Silver** | `Name` in white + tagline | Listed with tagline |
| **Bronze** | `Name` in dim | Listed by name |

### How to become a sponsor

1. [Open a sponsor issue](https://github.com/mksglu/claude-adhd/issues/new?template=become-a-sponsor.yml) with your details
2. A maintainer coordinates payment and creates a PR adding your entry to `sponsors.json`
3. Once the `payment-verified` label is applied, the PR is auto-validated and merged
4. Your sponsorship goes live -- the game fetches sponsors from jsDelivr CDN, so updates propagate automatically after merge

### `sponsors.json` format

```json
{
  "version": 1,
  "updated": "2026-03-16",
  "sponsors": [
    {
      "name": "Acme Corp",
      "tier": "gold",
      "text": "Build faster with Acme",
      "url": "https://acme.com",
      "since": "2026-03"
    }
  ]
}
```

| Field | Required | Constraints |
|---|---|---|
| `name` | Yes | Max 20 characters |
| `tier` | Yes | `bronze`, `silver`, or `gold` |
| `text` | Silver/Gold | Max 30 characters |
| `url` | No | Displayed as clickable link |
| `since` | Yes | `YYYY-MM` format |

Sponsor data is loaded with a fallback chain: **CDN** (jsDelivr, 3s timeout) -> **local cache** (`~/.claude-adhd-sponsors.json`) -> **bundled** `sponsors.json` -> empty array.

---

## Configuration

### Environment variables

| Variable | Description |
|---|---|
| `ARCADE_DEBUG=1` | Enables debug logging to `/tmp/claude-adhd-debug.log` |

### Threshold

The default suggestion threshold is **5**. This is defined in `arcade-hooks.mjs` as `DEFAULT_CONFIG.suggestThreshold`. To adjust it, modify the value in the source.

### Swapping the game

The game path is passed through the hook system. Replace `flappy.mjs` with any terminal game that:
- Runs via `node your-game.mjs`
- Uses stdin for input and stdout for rendering
- Exits cleanly on `SIGTERM`

---

## Development

```bash
# Run all 108 tests
npm test

# Validate sponsor data against schema
node scripts/validate-sponsors.mjs

# Show current version
node arcade-hooks.mjs --version

# Update to latest (git pull)
node arcade-hooks.mjs --upgrade

# Detect current terminal
node terminal-adapter.mjs --detect

# Run the game standalone
node flappy.mjs
```

Zero dependencies. Node.js only.

---

## Architecture

```
User prompt
    │
    ▼
UserPromptSubmit hook
    │  Scores the prompt against weighted signals
    │  Saves score to temp file if > 0
    │
    ▼
PreToolUse hook (Bash / Agent / Task)
    │  Scores the tool call
    │  Combines with saved prompt score
    │  If combined score >= threshold:
    │    - Checks if game is already running (pgrep)
    │    - Opens split pane via terminal-adapter.mjs
    │    - Injects context telling Claude to mention the game
    │
    ▼
terminal-adapter.mjs
    │  Detects terminal type
    │  Runs the appropriate split-pane command
    │
    ▼
flappy.mjs
    │  Pure ANSI terminal Flappy Bird
    │  Cell-level diff rendering (20fps)
    │  Sponsor display on start screen
    │
    ▼
Claude finishes task
    │  Runs: node terminal-adapter.mjs --hook-close
    └─ Game pane closes
```

---

## License

[MIT](LICENSE)
