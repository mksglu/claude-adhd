import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok, match } from 'node:assert';
import {
  scorePrompt,
  scoreTool,
  shouldSuggestGame,
  buildSuggestionContext,
  isGameAffirmation,
  isGameProcessRunning,
  loadGameState,
  checkForUpdate,
  VERSION,
  SIGNALS,
  DEFAULT_CONFIG,
} from './arcade-hooks.mjs';

// ═══════════════════════════════════════════════════════════
// scorePrompt — weighted signal scoring
// ═══════════════════════════════════════════════════════════

describe('scorePrompt', () => {
  it('returns 0 for empty prompt', () => {
    const result = scorePrompt('');
    strictEqual(result.score, 0);
    deepStrictEqual(result.signals, []);
  });

  it('returns 0 for short simple prompt', () => {
    const result = scorePrompt('fix the typo in readme');
    strictEqual(result.score, 0);
    deepStrictEqual(result.signals, []);
  });

  it('scores extended thinking keywords high', () => {
    const r1 = scorePrompt('ultrathink about this');
    ok(r1.score >= 5, `expected >= 5, got ${r1.score}`);
    ok(r1.signals.includes('extended-thinking'));

    const r2 = scorePrompt('think deeply about the architecture');
    ok(r2.score >= 5, `expected >= 5, got ${r2.score}`);
    ok(r2.signals.includes('extended-thinking'));
  });

  it('scores parallel/agent work', () => {
    const result = scorePrompt('run parallel agents to analyze the codebase');
    ok(result.signals.includes('parallel-work'));
    ok(result.signals.includes('agent-mention'));
  });

  it('scores architecture/refactor keywords', () => {
    const result = scorePrompt('refactor the entire authentication module');
    ok(result.signals.includes('architecture'));
    ok(result.signals.includes('broad-scope'));
  });

  it('scores TDD/test-driven patterns', () => {
    const result = scorePrompt('implement this with TDD red-green-refactor');
    ok(result.signals.includes('tdd'));
  });

  it('scores long prompts', () => {
    const longPrompt = 'a '.repeat(300); // 600 chars
    const result = scorePrompt(longPrompt);
    ok(result.signals.includes('long-prompt'));
  });

  it('scores very long prompts higher', () => {
    const veryLong = 'a '.repeat(800); // 1600 chars
    const result = scorePrompt(veryLong);
    ok(result.signals.includes('long-prompt'));
    ok(result.signals.includes('very-long-prompt'));
    ok(result.score > scorePrompt('a '.repeat(300)).score);
  });

  it('scores code blocks', () => {
    const prompt = 'implement this:\n```typescript\ninterface Foo {\n  bar: string;\n}\n```\nand also:\n```typescript\nclass Baz {}\n```';
    const result = scorePrompt(prompt);
    ok(result.signals.includes('code-blocks'));
  });

  it('scores multi-step keywords', () => {
    const result = scorePrompt('plan and design the implementation, then build it');
    ok(result.signals.includes('multi-step'));
  });

  it('accumulates signals additively', () => {
    // Single signal
    const single = scorePrompt('ultrathink');
    // Multiple signals
    const multi = scorePrompt('ultrathink, refactor the entire codebase with TDD using parallel agents');
    ok(multi.score > single.score, `multi(${multi.score}) should be > single(${single.score})`);
    ok(multi.signals.length > single.signals.length);
  });

  it('real-world complex prompt scores high', () => {
    const prompt = `ultrathink about this. I need you to refactor the entire auth module.
    Use TDD with red-green-refactor. Run parallel agents for the different components.
    The migration should handle all existing users and their sessions.`;
    const result = scorePrompt(prompt);
    ok(result.score >= 10, `expected >= 10 for complex prompt, got ${result.score}`);
  });

  it('real-world simple prompt scores low', () => {
    const result = scorePrompt('rename the variable from foo to bar');
    ok(result.score < 3, `expected < 3 for simple prompt, got ${result.score}`);
  });

  it('detects reasoning effort markers in system context', () => {
    const result = scorePrompt('reasoning effort level: high. Do a full code review');
    ok(result.signals.includes('high-reasoning-effort'));
  });
});

// ═══════════════════════════════════════════════════════════
// scoreTool — tool-based scoring
// ═══════════════════════════════════════════════════════════

describe('scoreTool', () => {
  it('returns 0 for Read tool', () => {
    const result = scoreTool('Read', { file_path: '/some/file.ts' });
    strictEqual(result.score, 0);
  });

  it('returns 0 for Grep tool', () => {
    const result = scoreTool('Grep', { pattern: 'foo' });
    strictEqual(result.score, 0);
  });

  it('returns 0 for Glob tool', () => {
    const result = scoreTool('Glob', { pattern: '**/*.ts' });
    strictEqual(result.score, 0);
  });

  it('scores Agent tool high', () => {
    const result = scoreTool('Agent', { prompt: 'research the codebase', subagent_type: 'Explore' });
    ok(result.score >= 4, `expected >= 4 for Agent, got ${result.score}`);
    ok(result.signals.includes('tool-agent'));
  });

  it('scores Bash with build commands', () => {
    const result = scoreTool('Bash', { command: 'npm run build' });
    ok(result.score >= 2, `expected >= 2 for build, got ${result.score}`);
    ok(result.signals.includes('tool-bash-build'));
  });

  it('scores Bash with test commands', () => {
    const result = scoreTool('Bash', { command: 'npm test' });
    ok(result.score >= 2);
    ok(result.signals.includes('tool-bash-test'));
  });

  it('scores Bash with install commands', () => {
    const result = scoreTool('Bash', { command: 'npm install' });
    ok(result.score >= 2);
    ok(result.signals.includes('tool-bash-install'));
  });

  it('returns 0 for Bash with simple commands', () => {
    const result = scoreTool('Bash', { command: 'git status' });
    strictEqual(result.score, 0);
  });

  it('returns 0 for Bash with short commands', () => {
    const result = scoreTool('Bash', { command: 'ls' });
    strictEqual(result.score, 0);
  });

  it('scores Edit tool as 0', () => {
    const result = scoreTool('Edit', { file_path: '/f.ts', old_string: 'a', new_string: 'b' });
    strictEqual(result.score, 0);
  });

  it('scores Write tool as 0', () => {
    const result = scoreTool('Write', { file_path: '/f.ts', content: 'hello' });
    strictEqual(result.score, 0);
  });

  it('returns 0 for unknown tools', () => {
    const result = scoreTool('SomeWeirdTool', {});
    strictEqual(result.score, 0);
  });

  it('scores Agent with background=true higher', () => {
    const bg = scoreTool('Agent', { prompt: 'do stuff', run_in_background: true });
    const fg = scoreTool('Agent', { prompt: 'do stuff' });
    ok(bg.score >= fg.score, 'background agent should score >= foreground');
  });

  it('scores multiple parallel Agent tool mentions from prompt', () => {
    const result = scoreTool('Agent', { prompt: 'analyze', subagent_type: 'general-purpose' });
    ok(result.score >= 4);
  });
});

// ═══════════════════════════════════════════════════════════
// shouldSuggestGame — threshold decisions
// ═══════════════════════════════════════════════════════════

describe('shouldSuggestGame', () => {
  it('returns none for score 0', () => {
    const result = shouldSuggestGame(0);
    strictEqual(result.action, 'none');
  });

  it('returns none for score below threshold', () => {
    const result = shouldSuggestGame(4);
    strictEqual(result.action, 'none');
  });

  it('returns suggest at default threshold', () => {
    const result = shouldSuggestGame(DEFAULT_CONFIG.suggestThreshold);
    strictEqual(result.action, 'suggest');
  });

  it('returns suggest for high scores', () => {
    const result = shouldSuggestGame(15);
    strictEqual(result.action, 'suggest');
  });

  it('supports custom threshold via config', () => {
    const result = shouldSuggestGame(3, { suggestThreshold: 3 });
    strictEqual(result.action, 'suggest');
  });

  it('returns none just below custom threshold', () => {
    const result = shouldSuggestGame(2, { suggestThreshold: 3 });
    strictEqual(result.action, 'none');
  });

  it('includes reason string', () => {
    const result = shouldSuggestGame(10);
    ok(typeof result.reason === 'string');
    ok(result.reason.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════
// buildSuggestionContext — XML context for Claude injection
// ═══════════════════════════════════════════════════════════

describe('buildSuggestionContext', () => {
  it('returns XML-structured context', () => {
    const ctx = buildSuggestionContext(
      { score: 12, signals: ['extended-thinking', 'architecture'] },
      '/path/to/terminal-adapter.mjs',
      '/path/to/flappy.mjs',
    );
    ok(ctx.includes('<arcade-notification') || ctx.includes('<arcade-suggestion'));
    ok(ctx.includes('</arcade-notification>') || ctx.includes('</arcade-suggestion>'));
  });

  it('includes score and signals', () => {
    const ctx = buildSuggestionContext(
      { score: 8, signals: ['tdd', 'parallel-work'] },
      '/a.mjs',
      '/b.mjs',
    );
    ok(ctx.includes('8'));
    ok(ctx.includes('tdd'));
    ok(ctx.includes('parallel-work'));
  });

  it('includes close command and adapter path', () => {
    const ctx = buildSuggestionContext(
      { score: 10, signals: ['extended-thinking'] },
      '/path/to/terminal-adapter.mjs',
      '/path/to/flappy.mjs',
    );
    ok(ctx.includes('terminal-adapter.mjs'));
    ok(ctx.includes('--hook-close'));
  });

  it('includes user-facing suggestion text', () => {
    const ctx = buildSuggestionContext(
      { score: 10, signals: ['extended-thinking'] },
      '/a.mjs',
      '/b.mjs',
    );
    // Should contain a Turkish or English suggestion for the user
    ok(ctx.includes('🎮') || ctx.includes('game') || ctx.includes('Flappy'));
  });
});

// ═══════════════════════════════════════════════════════════
// SIGNALS — signal registry integrity
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// isGameAffirmation — /btw response detection
// ═══════════════════════════════════════════════════════════

describe('isGameAffirmation', () => {
  it('detects Turkish affirmations', () => {
    strictEqual(isGameAffirmation('aç'), true);
    strictEqual(isGameAffirmation('ac'), true);
    strictEqual(isGameAffirmation('evet'), true);
    strictEqual(isGameAffirmation('tamam'), true);
    strictEqual(isGameAffirmation('hadi'), true);
  });

  it('detects English affirmations', () => {
    strictEqual(isGameAffirmation('yes'), true);
    strictEqual(isGameAffirmation('ok'), true);
    strictEqual(isGameAffirmation('okay'), true);
    strictEqual(isGameAffirmation('sure'), true);
    strictEqual(isGameAffirmation('yep'), true);
    strictEqual(isGameAffirmation('yup'), true);
    strictEqual(isGameAffirmation('open'), true);
    strictEqual(isGameAffirmation('play'), true);
    strictEqual(isGameAffirmation('go'), true);
  });

  it('detects other languages', () => {
    strictEqual(isGameAffirmation('oui'), true);
    strictEqual(isGameAffirmation('ja'), true);
    strictEqual(isGameAffirmation('sí'), true);
    strictEqual(isGameAffirmation('si'), true);
    strictEqual(isGameAffirmation('はい'), true);
  });

  it('is case insensitive', () => {
    strictEqual(isGameAffirmation('YES'), true);
    strictEqual(isGameAffirmation('Ok'), true);
    strictEqual(isGameAffirmation('AÇ'), true);
  });

  it('trims whitespace', () => {
    strictEqual(isGameAffirmation('  yes  '), true);
    strictEqual(isGameAffirmation('\naç\n'), true);
  });

  it('rejects non-affirmation text', () => {
    strictEqual(isGameAffirmation('fix the bug'), false);
    strictEqual(isGameAffirmation('no'), false);
    strictEqual(isGameAffirmation('hayır'), false);
    strictEqual(isGameAffirmation('refactor the code'), false);
    strictEqual(isGameAffirmation(''), false);
  });

  it('rejects long messages even with affirmation words', () => {
    strictEqual(isGameAffirmation('yes please open the game'), false);
    strictEqual(isGameAffirmation('ok but first fix the bug'), false);
  });

  it('handles null/undefined', () => {
    strictEqual(isGameAffirmation(null), false);
    strictEqual(isGameAffirmation(undefined), false);
  });
});

// ═══════════════════════════════════════════════════════════
// isGameProcessRunning — process-level detection
// ═══════════════════════════════════════════════════════════

describe('isGameProcessRunning', () => {
  it('returns false for a non-existent game', () => {
    strictEqual(isGameProcessRunning('nonexistent-game-12345.mjs'), false);
  });

  it('returns boolean', () => {
    const result = isGameProcessRunning();
    strictEqual(typeof result, 'boolean');
  });
});

// ═══════════════════════════════════════════════════════════
// buildSuggestionContext — /btw instructions
// ═══════════════════════════════════════════════════════════

describe('buildSuggestionContext auto-open flow', () => {
  it('tells Claude game was auto-opened when new', () => {
    const ctx = buildSuggestionContext(
      { score: 10, signals: ['extended-thinking'] },
      '/a.mjs', '/b.mjs', false,
    );
    ok(ctx.includes('auto-opened'));
    ok(ctx.includes('just-opened'));
  });

  it('tells Claude game is already open when alreadyOpen=true', () => {
    const ctx = buildSuggestionContext(
      { score: 10, signals: ['extended-thinking'] },
      '/a.mjs', '/b.mjs', true,
    );
    ok(ctx.includes('already-open'));
    ok(ctx.includes('ALREADY running'));
  });

  it('tells Claude to continue working in both cases', () => {
    const fresh = buildSuggestionContext({ score: 10, signals: [] }, '/a', '/b', false);
    const existing = buildSuggestionContext({ score: 10, signals: [] }, '/a', '/b', true);
    ok(fresh.includes('CONTINUE working') || fresh.includes('DO NOT STOP'));
    ok(existing.includes('CONTINUE working') || existing.includes('DO NOT STOP'));
  });
});

describe('SIGNALS', () => {
  it('all prompt signals have id, weight, and test function', () => {
    for (const sig of SIGNALS.prompt) {
      ok(typeof sig.id === 'string', `signal missing id`);
      ok(typeof sig.weight === 'number', `${sig.id} missing weight`);
      ok(typeof sig.test === 'function', `${sig.id} missing test function`);
      ok(sig.weight > 0, `${sig.id} weight must be positive`);
    }
  });

  it('all tool signals have id, weight, and test function', () => {
    for (const sig of SIGNALS.tool) {
      ok(typeof sig.id === 'string', `signal missing id`);
      ok(typeof sig.weight === 'number', `${sig.id} missing weight`);
      ok(typeof sig.test === 'function', `${sig.id} missing test function`);
      ok(sig.weight > 0, `${sig.id} weight must be positive`);
    }
  });

  it('no duplicate signal ids', () => {
    const allIds = [...SIGNALS.prompt.map(s => s.id), ...SIGNALS.tool.map(s => s.id)];
    const unique = new Set(allIds);
    strictEqual(unique.size, allIds.length, `duplicate signal ids found`);
  });
});

// ═══════════════════════════════════════════════════════════
// VERSION — version constant
// ═══════════════════════════════════════════════════════════

describe('VERSION', () => {
  it('is a valid semver string', () => {
    ok(typeof VERSION === 'string', 'VERSION must be a string');
    ok(/^\d+\.\d+\.\d+$/.test(VERSION), `VERSION "${VERSION}" must match x.y.z semver format`);
  });

  it('matches package.json version', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));
    strictEqual(VERSION, pkg.version, 'VERSION should match package.json version');
  });
});

// ═══════════════════════════════════════════════════════════
// checkForUpdate — CDN version check
// ═══════════════════════════════════════════════════════════

describe('checkForUpdate', () => {
  it('returns object with expected shape on success', async () => {
    const result = await checkForUpdate(VERSION);
    // CDN may or may not be reachable, so result can be null
    if (result !== null) {
      ok(typeof result === 'object', 'result must be an object');
      ok(typeof result.available === 'boolean', 'result.available must be boolean');
      ok(typeof result.latest === 'string', 'result.latest must be a string');
      ok(typeof result.current === 'string', 'result.current must be a string');
      strictEqual(result.current, VERSION, 'result.current should equal passed version');
    }
  });

  it('handles network failure gracefully', async () => {
    // Pass a fake version to ensure comparison runs, use an unreachable scenario
    // by testing that the function never throws
    try {
      const result = await checkForUpdate('0.0.0');
      // Result is either a valid object or null — never throws
      if (result !== null) {
        ok(typeof result.available === 'boolean');
        ok(typeof result.latest === 'string');
      }
    } catch (err) {
      // This should never happen
      ok(false, `checkForUpdate should not throw, but threw: ${err.message}`);
    }
  });

  it('returns null for non-existent version check', async () => {
    // checkForUpdate should handle any version string gracefully
    const result = await checkForUpdate('999.999.999');
    if (result !== null) {
      strictEqual(result.available, false, 'should not report update when current is very high');
    }
  });
});
