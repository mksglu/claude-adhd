#!/usr/bin/env node

// 🐦 Flappy Bird - Terminal Edition
// Claude Arcade — zero dependencies, pure ANSI

const stdout = process.stdout;
const stdin = process.stdin;

// ── Terminal setup (dynamic, capped for performance) ────
function getGameW() { return stdout.columns || 60; }
function getGameH() { return (stdout.rows || 24) - 2; }
let GAME_W = getGameW();
let GAME_H = getGameH();

stdout.on('resize', () => {
  GAME_W = getGameW();
  GAME_H = getGameH();
  fullRedraw = true;
  clear();
  render();
});

// ── Colors ──────────────────────────────────────────────
const R = '\x1b[0m';
const GREEN = '\x1b[32m';
const BRIGHT_GREEN = '\x1b[92m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const WHITE = '\x1b[97m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const BG_BLUE = '\x1b[44m';
const BG_GREEN = '\x1b[42m';
const BG_RED = '\x1b[41m';

// ── Game constants ──────────────────────────────────────
const GRAVITY = 0.3;
const FLAP_FORCE = -1.7;
const PIPE_GAP = 7;
const PIPE_SPEED = 1;
const PIPE_INTERVAL = 36;
const BIRD_X = 10;

// ── Game state ──────────────────────────────────────────
let bird = { y: Math.floor(GAME_H / 2), vy: 0 };
let pipes = [];
let score = 0;
let highScore = 0;
let gameOver = false;
let started = false;
let frame = 0;
let groundOffset = 0;

// ── High score persistence ──────────────────────────────
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSponsorsSync, loadSponsors } from './sponsor-loader.mjs';

// ── Sponsor state ─────────────────────────────────────────
let sponsors = [];
try { sponsors = loadSponsorsSync(); } catch {}
// Background async refresh
loadSponsors().then(s => { if (s.length) sponsors = s; }).catch(() => {});

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCORE_FILE = join(__dirname, '.highscore');
const VERSION = '1.0.0';

try { highScore = parseInt(readFileSync(SCORE_FILE, 'utf8')) || 0; } catch {}

function saveHighScore() {
  try { writeFileSync(SCORE_FILE, String(highScore)); } catch {}
}

// ── Terminal control ────────────────────────────────────
const BSU = '\x1b[?2026h'; // Begin Synchronized Update (prevents tearing)
const ESU = '\x1b[?2026l'; // End Synchronized Update
let drainReady = true;
let frameBuf = Buffer.allocUnsafe(65536); // pre-allocated, reusable

const write = (s) => {
  const needed = Buffer.byteLength(s);
  if (needed > frameBuf.length) frameBuf = Buffer.allocUnsafe(needed * 2);
  const written = frameBuf.write(s, 0);
  drainReady = stdout.write(frameBuf.subarray(0, written));
  if (!drainReady) stdout.once('drain', () => { drainReady = true; });
};
const moveTo = (x, y) => write(`\x1b[${y + 1};${x + 1}H`);
const hide = () => write('\x1b[?25l');
const show = () => write('\x1b[?25h');
const altScreen = () => write('\x1b[?1049h');
const mainScreen = () => write('\x1b[?1049l');
const clear = () => write('\x1b[2J');

// ── Bird frames ─────────────────────────────────────────
const BIRD_UP = [
  `${YELLOW}\\${WHITE}o${YELLOW})${R}`,    // flapping up
];
const BIRD_DOWN = [
  `${YELLOW}/${WHITE}o${YELLOW})${R}`,     // falling down
];
const BIRD_DEAD = `${RED}x${WHITE}o${RED})${R}`;

function getBird() {
  if (gameOver) return BIRD_DEAD;
  return bird.vy < 0 ? BIRD_UP[0] : BIRD_DOWN[0];
}

// ── Pipe generation ─────────────────────────────────────
function spawnPipe() {
  const minTop = 3;
  const maxTop = GAME_H - PIPE_GAP - 3;
  const topH = Math.floor(Math.random() * (maxTop - minTop)) + minTop;
  pipes.push({
    x: GAME_W,
    topH: topH,
    scored: false,
  });
}

// ── Collision detection ─────────────────────────────────
function checkCollision() {
  const by = Math.round(bird.y);

  // Floor / ceiling
  if (by <= 0 || by >= GAME_H - 1) return true;

  // Pipes
  for (const p of pipes) {
    const px = Math.round(p.x);
    if (BIRD_X >= px - 1 && BIRD_X <= px + 2) {
      if (by <= p.topH || by >= p.topH + PIPE_GAP) {
        return true;
      }
    }
  }
  return false;
}

// ── Render (cell-level diff — only changed cells written) ─
const C_EMPTY = 0, C_PIPE = 1, C_PIPE_EDGE = 2, C_CAP_TOP = 3, C_CAP_BOT = 4, C_GND_A = 5, C_GND_B = 6;
const CELL_CHAR = [' ', '█', '┃', '▄', '▀', '▀', '▔'];
const CELL_COLOR = ['', GREEN, GREEN, BRIGHT_GREEN, BRIGHT_GREEN, GREEN, BRIGHT_GREEN];

const MAX_ROWS = 100, MAX_COLS = 200;
const front = [], back = [];
for (let y = 0; y < MAX_ROWS; y++) {
  front[y] = new Uint8Array(MAX_COLS);
  back[y] = new Uint8Array(MAX_COLS);
}
let prevBirdY = -1;
let fullRedraw = true; // first frame = full

// Cell-level diff: scan each row, find dirty spans, batch same-color runs
function diffRender(parts) {
  for (let y = 0; y < GAME_H; y++) {
    let x = 0;
    while (x < GAME_W) {
      // Skip clean cells
      while (x < GAME_W && back[y][x] === front[y][x]) x++;
      if (x >= GAME_W) break;

      // Cursor to first dirty cell
      parts.push(`\x1b[${y + 2};${x + 1}H`);

      // Batch consecutive dirty cells with color grouping
      while (x < GAME_W && back[y][x] !== front[y][x]) {
        const t = back[y][x];
        if (t === C_EMPTY) {
          // Batch consecutive empty dirty cells
          let n = 0;
          while (x < GAME_W && back[y][x] === C_EMPTY && back[y][x] !== front[y][x]) {
            front[y][x] = back[y][x]; x++; n++;
          }
          parts.push(' '.repeat(n));
        } else {
          // Batch consecutive same-colored dirty cells
          parts.push(CELL_COLOR[t]);
          while (x < GAME_W && back[y][x] === t && back[y][x] !== front[y][x]) {
            parts.push(CELL_CHAR[t]);
            front[y][x] = back[y][x]; x++;
          }
          parts.push(R);
        }
      }
    }
  }
}

// Full render (first frame, resize, overlays)
function fullRenderRows(parts) {
  for (let y = 0; y < GAME_H; y++) {
    parts.push(`\x1b[${y + 2};1H`);
    let lastType = -1;
    for (let x = 0; x < GAME_W; x++) {
      const cell = back[y][x];
      if (cell !== lastType) {
        if (lastType > C_EMPTY) parts.push(R);
        if (cell > C_EMPTY) parts.push(CELL_COLOR[cell]);
        lastType = cell;
      }
      parts.push(CELL_CHAR[cell]);
    }
    if (lastType > C_EMPTY) parts.push(R);
    front[y].set(back[y].subarray(0, GAME_W));
  }
}

const parts = [];

function render() {
  if (!drainReady) return;
  parts.length = 0;
  parts.push(BSU);

  // Score bar
  parts.push(`\x1b[1;1H`);
  const scoreText = ` Score: ${BOLD}${WHITE}${score}${R}  ${DIM}Hi: ${highScore}${R}  ${DIM}[SPACE] flap  [Q] quit${R}`;
  parts.push(`${BG_BLUE}${scoreText}${' '.repeat(Math.max(0, GAME_W - stripAnsi(scoreText).length))}${R}`);

  // Clear back buffer
  for (let y = 0; y < GAME_H; y++) back[y].fill(C_EMPTY, 0, GAME_W);

  // Draw pipes
  for (const p of pipes) {
    const px = Math.round(p.x);
    for (let col = px; col < px + 3; col++) {
      if (col < 0 || col >= GAME_W) continue;
      const bodyType = col === px ? C_PIPE_EDGE : C_PIPE;
      for (let y = 0; y < p.topH; y++) back[y][col] = bodyType;
      if (p.topH > 0 && p.topH < GAME_H) back[p.topH][col] = C_CAP_TOP;
      const bottomStart = p.topH + PIPE_GAP;
      if (bottomStart > 0 && bottomStart < GAME_H) back[bottomStart][col] = C_CAP_BOT;
      for (let y = bottomStart + 1; y < GAME_H; y++) back[y][col] = bodyType;
    }
  }

  // Draw ground
  for (let x = 0; x < GAME_W; x++) {
    back[GAME_H - 1][x] = (x + groundOffset) % 4 === 0 ? C_GND_A : C_GND_B;
  }

  // Diff or full render
  if (fullRedraw) {
    fullRenderRows(parts);
    fullRedraw = false;
  } else {
    diffRender(parts);
  }

  // Bird overlay
  const by = Math.round(bird.y);
  if (started) {
    if (prevBirdY >= 0 && prevBirdY !== by && prevBirdY < GAME_H) {
      // Erase old bird — re-render those 3 cells from back buffer
      const py = prevBirdY;
      for (let dx = 0; dx < 3; dx++) {
        const bx = BIRD_X + dx;
        if (bx >= GAME_W) break;
        const c = back[py][bx];
        parts.push(`\x1b[${py + 2};${bx + 1}H`);
        if (c === C_EMPTY) parts.push(' ');
        else parts.push(CELL_COLOR[c] + CELL_CHAR[c] + R);
      }
    }
    if (by >= 0 && by < GAME_H) {
      parts.push(`\x1b[${by + 2};${BIRD_X + 1}H${getBird()}`);
    }
    prevBirdY = by;
  }

  // Game over overlay
  if (gameOver) {
    const centerY = Math.floor(GAME_H / 2);
    const box = [
      `╔══════════════════════╗`,
      `║   ${RED}${BOLD}G A M E  O V E R${R}   ║`,
      `║                      ║`,
      `║   Score: ${BOLD}${String(score).padStart(4)}${R}        ║`,
      `║   Best:  ${BOLD}${String(highScore).padStart(4)}${R}        ║`,
      `║                      ║`,
      `║  ${DIM}[SPACE] restart${R}     ║`,
      `║  ${DIM}[Q] quit${R}            ║`,
      `╚══════════════════════╝`,
    ];
    const boxW = 24;
    const startX = Math.floor((GAME_W - boxW) / 2);
    const yOffset = 3;
    box.forEach((line, i) => {
      parts.push(`\x1b[${centerY - yOffset + i};${startX + 1}H${CYAN}${line}${R}`);
    });
  }

  // Start screen
  if (!started && !gameOver) {
    const centerY = Math.floor(GAME_H / 2);
    const lines = [
      `${BOLD}${YELLOW}~~ FLAPPY BIRD ~~${R} ${DIM}v${VERSION}${R}`,
      ``,
      `${DIM}Press SPACE to start${R}`,
    ];

    if (sponsors.length > 0) {
      lines.push(``);
      lines.push(`${DIM}── Sponsors ──${R}`);
      const tierOrder = { gold: 0, silver: 1, bronze: 2 };
      const sorted = [...sponsors].sort((a, b) => (tierOrder[a.tier] ?? 3) - (tierOrder[b.tier] ?? 3));
      const visible = sorted.slice(0, 5);
      for (const s of visible) {
        const linkName = s.url ? hyperlink(s.url, s.name) : s.name;
        if (s.tier === 'gold') {
          let line = `${YELLOW}${BOLD}★ ${linkName}${R}`;
          if (s.text) line += ` ${DIM}· ${s.text}${R}`;
          lines.push(line);
        } else if (s.tier === 'silver') {
          let line = `${WHITE}${linkName}${R}`;
          if (s.text) line += ` ${DIM}· ${s.text}${R}`;
          lines.push(line);
        } else {
          lines.push(`${DIM}${linkName}${R}`);
        }
      }
      const sponsorUrl = 'https://github.com/mksglu/claude-adhd/issues/new?template=become-a-sponsor.yml';
      lines.push(``);
      lines.push(`${DIM}${hyperlink(sponsorUrl, '→ Become a Sponsor')} (Cmd+Click)${R}`);
    }

    const totalLines = lines.length;
    const startY = centerY - Math.floor(totalLines / 2);
    const maxVisibleWidth = lines.reduce((max, l) => Math.max(max, stripAnsi(l).length), 0);
    const blockStartX = Math.floor((GAME_W - maxVisibleWidth) / 2);

    lines.forEach((line, i) => {
      parts.push(`\x1b[${startY + i};${Math.max(1, blockStartX + 1)}H${line}`);
    });
  }

  parts.push(ESU); // atomic frame end
  write(parts.join(''));
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\]8;;[^\x07]*\x07/g, '');
}

// OSC 8 hyperlink: clickable text in supported terminals (iTerm2, Kitty, WezTerm, etc.)
function hyperlink(url, text) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// ── Update ──────────────────────────────────────────────
function update() {
  if (!started || gameOver) return;

  frame++;

  // Bird physics
  bird.vy += GRAVITY;
  bird.y += bird.vy;

  // Move pipes
  for (const p of pipes) {
    p.x -= PIPE_SPEED;

    // Score
    if (!p.scored && p.x + 2 < BIRD_X) {
      p.scored = true;
      score++;
      if (score > highScore) {
        highScore = score;
        saveHighScore();
      }
    }
  }

  // Remove off-screen pipes
  // In-place pipe removal (avoids array allocation per frame)
  let w = 0;
  for (let i = 0; i < pipes.length; i++) {
    if (pipes[i].x > -5) pipes[w++] = pipes[i];
  }
  pipes.length = w;

  // Spawn new pipes
  if (frame % PIPE_INTERVAL === 0) {
    spawnPipe();
  }

  // Ground scroll
  groundOffset = (groundOffset + 1) % 4;

  // Collision
  if (checkCollision()) {
    gameOver = true;
    saveHighScore();
    render(); // Final render with game over screen
  }
}

// ── Input handling ──────────────────────────────────────
function flap() {
  if (gameOver) {
    // Restart
    bird = { y: Math.floor(GAME_H / 2), vy: 0 };
    pipes = [];
    score = 0;
    gameOver = false;
    started = true;
    frame = 0;
    fullRedraw = true; // clear game over overlay
    return;
  }
  if (!started) {
    started = true;
    spawnPipe();
  }
  bird.vy = FLAP_FORCE;
}

// ── Main ────────────────────────────────────────────────
function cleanup() {
  show();
  mainScreen();
  stdin.setRawMode(false);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

altScreen();
hide();
clear();
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');

stdin.on('data', (key) => {
  if (key === 'q' || key === 'Q' || key === '\x03') {
    cleanup();
  }
  if (key === ' ' || key === '\x1b[A') { // space or up arrow
    flap();
  }
});

// Game loop — simple setTimeout (low CPU, cell-diff handles smoothness)
function gameLoop() {
  if (started && !gameOver) {
    update();
    render();
  }
  setTimeout(gameLoop, 50); // 20fps
}

// Initial render (once for start screen), then start loop
render();
gameLoop();
