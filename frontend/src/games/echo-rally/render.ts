/**
 * Draws an Echo Rally court on a canvas: the court itself, the dashed net, big
 * arcade score digits, fog, shields, the Echo marker, the paddles, the balls
 * and the echo rings every hit sends out. Drawing only: it never changes the
 * game.
 */
import type { Bursts } from "../../platform/burst";
import { contactX, hidden, padH, predictY, rules, type Ball, type Game } from "./engine";
import type { BallArt, CourtArt, PaddleArt } from "./items";

export interface Look {
  /** Paddle art for each side (0 = left). */
  paddles: [PaddleArt, PaddleArt];
  ball: BallArt;
  court: CourtArt;
  /** Light graphics or reduced motion: no glow, trails or rings. */
  light: boolean;
}

/** A sonar ring from a paddle hit (court units, real ms). */
export interface Ring {
  x: number;
  y: number;
  born: number;
  color: string;
}

export interface Frame {
  game: Game;
  /** Paddle heights and ball spots before the last tick (smooth motion). */
  prevPads: [number, number];
  prevBalls: { x: number; y: number }[];
  /** 0..1: how far into the current tick we are. */
  alpha: number;
  rings: Ring[];
  /** Real time in ms. */
  time: number;
  bursts: Bursts | null;
  /** The side this screen plays (sees through its own Ghost, is hidden by Fog). */
  me: number;
}

export const RING_MS = 520;

/** Board height for a board `w` pixels wide. */
export const boardHeight = (w: number) => (w * rules.height) / rules.width;

/** `#rrggbb` with an alpha. */
export function alphaOf(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** `#rrggbb` mixed toward black (amt < 0) or white (amt > 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Court
// ---------------------------------------------------------------------------

function drawCourt(ctx: CanvasRenderingContext2D, w: number, h: number, c: CourtArt, light: boolean) {
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const u = w / 64;
  ctx.strokeStyle = c.line;
  ctx.fillStyle = c.line;
  ctx.lineWidth = 1;
  switch (c.style) {
    case "grid": {
      ctx.beginPath();
      for (let x = u * 4; x < w; x += u * 4) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, h);
      }
      for (let y = u * 4; y < h; y += u * 4) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
      }
      ctx.stroke();
      break;
    }
    case "scan": {
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      break;
    }
    case "synth": {
      // A floor grid running to a horizon behind the net.
      const hz = h * 0.5;
      ctx.beginPath();
      for (let i = -8; i <= 8; i++) {
        ctx.moveTo(w / 2 + i * u * 1.2, hz);
        ctx.lineTo(w / 2 + i * u * 9, h);
        ctx.moveTo(w / 2 + i * u * 1.2, hz);
        ctx.lineTo(w / 2 + i * u * 9, 0);
      }
      for (let k = 1; k < 7; k++) {
        const d = (k * k * h) / 100;
        ctx.moveTo(0, hz + d);
        ctx.lineTo(w, hz + d);
        ctx.moveTo(0, hz - d);
        ctx.lineTo(w, hz - d);
      }
      ctx.stroke();
      break;
    }
    case "cabinet": {
      // A bezel: the screen sits inside a darker frame with rounded corners.
      const b = u * 1.2;
      ctx.lineWidth = b;
      ctx.strokeStyle = c.line;
      ctx.strokeRect(b / 2, b / 2, w - b, h - b);
      ctx.lineWidth = 1;
      ctx.strokeStyle = alphaOf(c.accent, 0.5);
      ctx.strokeRect(b + 2.5, b + 2.5, w - 2 * b - 5, h - 2 * b - 5);
      break;
    }
    case "stadium": {
      // Court lines: outer box and service boxes.
      ctx.strokeStyle = alphaOf(c.net, 0.35);
      ctx.lineWidth = 2;
      ctx.strokeRect(u * 2, u * 2, w - u * 4, h - u * 4);
      ctx.beginPath();
      ctx.moveTo(u * 2, h / 2);
      ctx.lineTo(w - u * 2, h / 2);
      ctx.stroke();
      if (!light) {
        // Floodlight pools in the corners.
        for (const [x, y] of [
          [0, 0],
          [w, 0],
          [0, h],
          [w, h],
        ]) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.35);
          g.addColorStop(0, alphaOf(c.accent, 0.12));
          g.addColorStop(1, alphaOf(c.accent, 0));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      }
      break;
    }
    case "space": {
      for (let i = 0; i < 70; i++) {
        const r = hash(i, 7);
        const x = (r % 1000) / 1000;
        const y = ((r >>> 10) % 1000) / 1000;
        ctx.fillStyle = alphaOf(i % 9 === 0 ? c.accent : "#FFFFFF", 0.25 + ((r >>> 20) % 50) / 100);
        const s = i % 13 === 0 ? 2 : 1;
        ctx.fillRect(Math.round(x * w), Math.round(y * h), s, s);
      }
      break;
    }
    default:
      break;
  }
}

function drawNet(ctx: CanvasRenderingContext2D, w: number, h: number, c: CourtArt) {
  const seg = Math.max(4, h / 24);
  const nw = Math.max(2, Math.round(w / 220));
  ctx.fillStyle = alphaOf(c.net, 0.55);
  for (let y = seg / 4; y < h; y += seg) ctx.fillRect(Math.round(w / 2 - nw / 2), Math.round(y), nw, Math.round(seg / 2));
}

/** 3 x 5 pixel digits, like an old arcade scoreboard. */
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

function drawDigits(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, px: number) {
  const width = text.length * 4 * px - px;
  let x = Math.round(cx - width / 2);
  for (const ch of text) {
    const d = DIGITS[Number(ch)] ?? DIGITS[0];
    for (let i = 0; i < 15; i++) if (d[i] === "1") ctx.fillRect(x + (i % 3) * px, Math.round(top) + Math.trunc(i / 3) * px, px, px);
    x += 4 * px;
  }
}

// ---------------------------------------------------------------------------
// Paddles and balls
// ---------------------------------------------------------------------------

function drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number, pw: number, ph: number, a: PaddleArt, frozen: boolean, light: boolean) {
  const left = Math.round(x);
  const top = Math.round(y - ph / 2);
  const wd = Math.max(3, Math.round(pw));
  const ht = Math.round(ph);
  switch (a.style) {
    case "chrome": {
      const g = ctx.createLinearGradient(left, 0, left + wd, 0);
      g.addColorStop(0, shade(a.color, -0.35));
      g.addColorStop(0.45, a.edge);
      g.addColorStop(1, shade(a.color, -0.2));
      ctx.fillStyle = g;
      ctx.fillRect(left, top, wd, ht);
      break;
    }
    case "laser":
      ctx.fillStyle = a.color;
      ctx.fillRect(left, top, wd, ht);
      ctx.strokeStyle = a.edge;
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 1, top + 1, wd - 2, ht - 2);
      break;
    case "crystal": {
      ctx.fillStyle = a.color;
      ctx.fillRect(left, top, wd, ht);
      ctx.strokeStyle = alphaOf(a.edge, 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < ht; k += wd * 2) {
        ctx.moveTo(left, top + k);
        ctx.lineTo(left + wd, top + Math.min(ht, k + wd * 2));
      }
      ctx.stroke();
      break;
    }
    case "gold":
      ctx.fillStyle = a.color;
      ctx.fillRect(left, top, wd, ht);
      ctx.fillStyle = a.edge;
      ctx.fillRect(left + Math.round(wd * 0.25), top + 2, Math.max(1, Math.round(wd * 0.2)), ht - 4);
      break;
    case "neon":
      if (!light) {
        ctx.shadowColor = a.color;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = a.color;
      ctx.fillRect(left, top, wd, ht);
      ctx.shadowBlur = 0;
      ctx.fillStyle = a.edge;
      ctx.fillRect(left + Math.round(wd / 3), top + 2, Math.max(1, Math.round(wd / 3)), ht - 4);
      break;
    default:
      ctx.fillStyle = a.color;
      ctx.fillRect(left, top, wd, ht);
  }
  if (frozen) {
    ctx.fillStyle = "rgba(184, 232, 255, 0.55)";
    ctx.fillRect(left - 2, top - 2, wd + 4, ht + 4);
    ctx.strokeStyle = "#E8F8FF";
    ctx.lineWidth = 1;
    ctx.strokeRect(left - 1.5, top - 1.5, wd + 3, ht + 3);
  }
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, b: Ball, a: BallArt, light: boolean, faint: boolean) {
  ctx.save();
  if (faint) ctx.globalAlpha = 0.18;
  const sp = Math.hypot(b.vx, b.vy) || 1;
  const dx = (b.vx / sp) * r;
  const dy = (b.vy / sp) * r;
  // Trails for the moving styles.
  if (!light && (a.style === "fire" || a.style === "comet" || a.style === "plasma")) {
    const n = a.style === "comet" ? 7 : 5;
    for (let k = n; k >= 1; k--) {
      const t = k / n;
      ctx.fillStyle = alphaOf(a.style === "fire" ? (k % 2 ? a.glow : a.color) : a.glow, 0.35 * (1 - t));
      const rr = r * (a.style === "comet" ? 1 - t * 0.8 : 0.9 - t * 0.3);
      ctx.beginPath();
      ctx.arc(x - dx * k * 1.1, y - dy * k * 1.1, Math.max(1, rr), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!light && a.glow !== "none") {
    ctx.shadowColor = a.glow;
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = a.color;
  if (a.style === "square") {
    ctx.fillRect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2));
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  if (a.style === "bat") {
    // Ping's ears and eyes.
    ctx.beginPath();
    ctx.moveTo(x - r * 0.9, y - r * 0.4);
    ctx.lineTo(x - r * 0.6, y - r * 1.5);
    ctx.lineTo(x - r * 0.1, y - r * 0.8);
    ctx.moveTo(x + r * 0.9, y - r * 0.4);
    ctx.lineTo(x + r * 0.6, y - r * 1.5);
    ctx.lineTo(x + r * 0.1, y - r * 0.8);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    const e = Math.max(1, r * 0.28);
    ctx.fillRect(Math.round(x - r * 0.45), Math.round(y - r * 0.2), e, e);
    ctx.fillRect(Math.round(x + r * 0.2), Math.round(y - r * 0.2), e, e);
  } else if (a.style === "plasma") {
    ctx.fillStyle = a.glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  } else if (a.style === "rings" && !light) {
    ctx.strokeStyle = alphaOf(a.glow, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, f: Frame, look: Look): void {
  const g = f.game;
  const h = boardHeight(w);
  const s = w / rules.width;
  const c = look.court;
  const pr = rules.powers;
  ctx.clearRect(0, 0, w, h);
  drawCourt(ctx, w, h, c, look.light);
  drawNet(ctx, w, h, c);

  // Score digits, quiet behind the play.
  ctx.fillStyle = alphaOf(c.accent, 0.3);
  const px = Math.max(3, Math.round(w / 110));
  drawDigits(ctx, String(g.s.score[0]), w * 0.25, h * 0.08, px);
  drawDigits(ctx, String(g.s.score[1]), w * 0.75, h * 0.08, px);

  // Shields: a wall on the goal line.
  for (const side of [0, 1]) {
    if (g.pads[side].shield <= 0) continue;
    const sw = Math.max(2, pr.shield_w * s);
    const x = side === 0 ? 0 : w - sw;
    ctx.fillStyle = alphaOf(c.accent, 0.75);
    ctx.fillRect(Math.round(x), 0, Math.round(sw), h);
  }

  // Echo: where the ball will reach your side.
  const mine = g.pads[f.me];
  if (mine.echo > 0) {
    const cx = contactX(f.me);
    for (const b of g.balls) {
      const toward = f.me === 0 ? b.vx < 0 : b.vx > 0;
      if (!toward) continue;
      const y = predictY(b, cx) * s;
      ctx.strokeStyle = alphaOf(c.accent, 0.9);
      ctx.lineWidth = 2;
      const x = cx * s + (f.me === 0 ? -6 : 6);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(6, rules.ball_r * s * 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.stroke();
    }
  }

  // Paddles.
  for (const side of [0, 1] as const) {
    const p = g.pads[side];
    const y = lerp(f.prevPads[side], p.y, f.alpha) * s;
    const x = side === 0 ? rules.pad_inset * s : (rules.width - rules.pad_inset - rules.pad_w) * s;
    drawPaddle(ctx, x, y, rules.pad_w * s, padH(p) * s, look.paddles[side], p.freeze > 0, look.light);
  }

  // Balls.
  g.balls.forEach((b, i) => {
    const prev = f.prevBalls.length === g.balls.length ? f.prevBalls[i] : null;
    // A big jump (a bounce off a paddle face) isn't smoothed.
    const near = prev && Math.abs(prev.x - b.x) < 4000;
    const x = (near ? lerp(prev.x, b.x, f.alpha) : b.x) * s;
    const y = (near ? lerp(prev.y, b.y, f.alpha) : b.y) * s;
    const gone = hidden(b);
    if (gone && b.owner !== f.me) return;
    drawBall(ctx, x, y, Math.max(2.5, rules.ball_r * s), b, look.ball, look.light, gone);
  });

  // Fog over your half (you can only see near your paddle), and a light
  // haze over the rival's half when you fogged them.
  for (const side of [0, 1]) {
    if (g.pads[side].fog <= 0) continue;
    const clear = pr.fog_clear * s;
    const x0 = side === 0 ? clear : w / 2;
    const x1 = side === 0 ? w / 2 : w - clear;
    ctx.fillStyle = side === f.me ? "rgba(150, 160, 175, 0.96)" : "rgba(150, 160, 175, 0.25)";
    ctx.fillRect(Math.round(x0), 0, Math.round(x1 - x0), h);
  }

  // Echo rings from hits.
  if (!look.light) {
    for (const r of f.rings) {
      const t = (f.time - r.born) / RING_MS;
      if (t < 0 || t >= 1) continue;
      ctx.strokeStyle = alphaOf(r.color, 0.7 * (1 - t));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x * s, r.y * s, (rules.ball_r * 1.5 + t * 5000) * s, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  f.bursts?.draw(ctx);
}
