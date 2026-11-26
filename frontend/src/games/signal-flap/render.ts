/**
 * Draws a Signal Flap board on a canvas: the sky (with a little parallax),
 * lattice antenna towers with lit caps (striped when the gap slides), signal
 * bars, the ground, the trail, the drone and sparks. Drawing only: it never
 * changes the game.
 */
import type { Bursts } from "../../platform/burst";
import { gapBot, gapTop, groundY, rules, type Game, type Tower } from "./engine";
import type { DroneArt, SkyArt, TrailArt } from "./items";

export interface Look {
  drone: DroneArt;
  trail: TrailArt;
  sky: SkyArt;
  /** Light graphics or reduced motion: no parallax detail, no spin or blink. */
  light: boolean;
}

export interface Frame {
  game: Game;
  /** Drone height before the last tick (for smooth motion). */
  prevY: number;
  /** How far the course moved on the last tick (arena units). */
  lastSpeed: number;
  /** 0..1: how far into the current tick we are. */
  alpha: number;
  /** Distance flown so far (arena units), for parallax and ground marks. */
  scroll: number;
  /** Recent drone heights, newest first, one per tick (for the trail). */
  trail: number[];
  /** Real time in ms (rotor spin, light blink, hover bob). */
  time: number;
  bursts: Bursts | null;
  /** Draw the score big at the top of the board. */
  showScore: boolean;
}

/** Board height for a board `w` pixels wide. */
export const boardHeight = (w: number) => (w * rules.height) / rules.width;

/** Tiny deterministic hash for skylines and stars. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** `#rrggbb` mixed toward black (amt < 0) or white (amt > 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

/** `#rrggbb` with an alpha. */
function alphaOf(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, gy: number, sky: SkyArt, scroll: number, light: boolean, time: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, gy);
  grad.addColorStop(0, sky.top);
  grad.addColorStop(1, sky.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  if (light) return;
  const far = scroll * 0.18;
  const unit = w / 48;
  switch (sky.style) {
    case "plain": {
      // A few flat clouds.
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      for (let i = 0; i < 4; i++) {
        const cw = unit * (8 + (hash(i, 7) % 6));
        const x = mod(hash(i, 1) % 1000 * (w / 600) - far * 0.5, w + cw * 2) - cw;
        const y = gy * (0.12 + ((hash(i, 2) % 100) / 100) * 0.4);
        ctx.beginPath();
        ctx.ellipse(x, y, cw / 2, unit * 1.6, 0, 0, Math.PI * 2);
        ctx.ellipse(x - cw * 0.18, y - unit * 1.1, cw / 4, unit * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "city": {
      // A skyline far behind with a few lit windows.
      const bw = unit * 5;
      const off = mod(far, bw);
      const first = Math.floor(far / bw);
      for (let i = -1; i < w / bw + 2; i++) {
        const k = first + i;
        const bh = gy * (0.14 + ((hash(k, 3) % 100) / 100) * 0.26);
        const x = i * bw - off;
        ctx.fillStyle = shade(sky.bottom, -0.35);
        ctx.fillRect(x, gy - bh, bw - unit * 0.6, bh);
        ctx.fillStyle = alphaOf(sky.accent, 0.7);
        for (let wy = 0; wy < 6; wy++) {
          for (let wx = 0; wx < 2; wx++) {
            if (hash(k * 13 + wx, wy) % 5 !== 0) continue;
            const yy = gy - bh + unit * (1.2 + wy * 2.2);
            if (yy > gy - unit) continue;
            ctx.fillRect(x + unit * (1 + wx * 2), yy, unit * 0.9, unit * 0.9);
          }
        }
      }
      break;
    }
    case "grid": {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
      ctx.lineWidth = 1;
      const step = unit * 3;
      ctx.beginPath();
      for (let x = -mod(far, step); x < w; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, gy);
      }
      for (let y = step; y < gy; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
      }
      ctx.stroke();
      break;
    }
    case "scan": {
      ctx.fillStyle = alphaOf(sky.accent, 0.05);
      for (let y = 0; y < gy; y += 4) ctx.fillRect(0, y, w, 1.5);
      ctx.fillStyle = alphaOf(sky.accent, 0.18);
      ctx.font = `${Math.max(8, unit * 1.4)}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < 6; i++) {
        const x = mod((hash(i, 4) % 1000) * (w / 700) - far * 0.6, w + unit * 12) - unit * 6;
        ctx.fillText(hash(i, 5).toString(2).slice(0, 8), x, gy * (0.08 + i * 0.12));
      }
      break;
    }
    case "sun": {
      const cx = w * 0.62;
      const cy = gy * 0.78;
      const r = w * 0.2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = sky.accent;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      // Bands cut across the lower half.
      ctx.fillStyle = sky.bottom;
      for (let i = 0; i < 5; i++) ctx.fillRect(cx - r, cy + i * r * 0.2, r * 2, r * 0.04 + i * r * 0.02);
      ctx.restore();
      break;
    }
    case "synth": {
      // A grid floor rushing toward you under the sky.
      const top = gy * 0.66;
      ctx.fillStyle = shade(sky.bottom, -0.3);
      ctx.fillRect(0, top, w, gy - top);
      ctx.strokeStyle = alphaOf(sky.accent, 0.32);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rows = 7;
      const phase = mod(scroll * 0.004, 1);
      for (let i = 0; i < rows; i++) {
        const t = (i + phase) / rows;
        const y = top + (gy - top) * t * t;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      for (let i = -8; i <= 8; i++) {
        ctx.moveTo(w / 2 + i * unit * 1.5, top);
        ctx.lineTo(w / 2 + i * unit * 9, gy);
      }
      ctx.stroke();
      break;
    }
    case "aurora": {
      const t = time * 0.00025;
      for (let band = 0; band < 3; band++) {
        ctx.fillStyle = alphaOf(sky.accent, 0.1 + band * 0.04);
        ctx.beginPath();
        const base = gy * (0.18 + band * 0.1);
        ctx.moveTo(0, base);
        for (let x = 0; x <= w; x += unit * 2) {
          ctx.lineTo(x, base + Math.sin(x / (unit * 7) + t + band) * unit * 2.2 - (far * 0.02) % 1);
        }
        for (let x = w; x >= 0; x -= unit * 2) {
          ctx.lineTo(x, base + unit * 5 + Math.sin(x / (unit * 9) - t + band * 2) * unit * 1.5);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "space": {
      for (let i = 0; i < 60; i++) {
        const x = mod((hash(i, 8) % 4800) * (w / 4800) - far * (0.3 + (i % 3) * 0.2), w);
        const y = ((hash(i, 9) % 1000) / 1000) * gy;
        ctx.fillStyle = i % 7 === 0 ? sky.accent : "rgba(255, 255, 255, 0.8)";
        const sz = i % 5 === 0 ? 2 : 1;
        ctx.fillRect(x, y, sz, sz);
      }
      // A small ringed planet.
      const px = mod(w * 0.75 - far * 0.08, w + unit * 20) - unit * 6;
      ctx.fillStyle = "#6E5FB0";
      ctx.beginPath();
      ctx.arc(px, gy * 0.22, unit * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = alphaOf(sky.accent, 0.8);
      ctx.lineWidth = Math.max(1, unit * 0.5);
      ctx.beginPath();
      ctx.ellipse(px, gy * 0.22, unit * 5.5, unit * 1.3, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Towers, bars, ground
// ---------------------------------------------------------------------------

/** One lattice section of a tower, from y0 to y1 (pixels). */
function lattice(ctx: CanvasRenderingContext2D, x: number, tw: number, y0: number, y1: number, sky: SkyArt, light: boolean) {
  if (y1 - y0 <= 0) return;
  ctx.fillStyle = sky.tower;
  ctx.fillRect(x, y0, tw, y1 - y0);
  if (light) return;
  // Cross braces, anchored to the arena so they don't crawl.
  const step = tw;
  ctx.strokeStyle = shade(sky.tower, -0.3);
  ctx.lineWidth = Math.max(1, tw * 0.07);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y0, tw, y1 - y0);
  ctx.clip();
  ctx.beginPath();
  for (let y = Math.floor(y0 / step) * step; y < y1; y += step) {
    ctx.moveTo(x + tw * 0.15, y);
    ctx.lineTo(x + tw * 0.85, y + step);
    ctx.moveTo(x + tw * 0.85, y);
    ctx.lineTo(x + tw * 0.15, y + step);
    ctx.moveTo(x, y);
    ctx.lineTo(x + tw, y);
  }
  ctx.stroke();
  ctx.restore();
  // Rails down both sides.
  ctx.fillStyle = shade(sky.tower, -0.3);
  const rail = Math.max(1.5, tw * 0.12);
  ctx.fillRect(x, y0, rail, y1 - y0);
  ctx.fillRect(x + tw - rail, y0, rail, y1 - y0);
}

function drawTower(ctx: CanvasRenderingContext2D, t: Tower, x: number, s: number, gy: number, sky: SkyArt, light: boolean, blink: boolean) {
  const tw = rules.tower_w * s;
  const top = gapTop(t) * s;
  const bot = gapBot(t) * s;
  lattice(ctx, x, tw, 0, top, sky, light);
  lattice(ctx, x, tw, bot, gy, sky, light);
  // Caps at the gap: wider plates; sliding gaps get hazard stripes.
  const capH = Math.max(4, 9 * (tw / 64));
  const over = tw * 0.12;
  for (const [cy, dir] of [
    [top - capH, -1],
    [bot, 1],
  ] as const) {
    ctx.fillStyle = shade(sky.tower, -0.45);
    ctx.fillRect(x - over, cy, tw + over * 2, capH);
    if (t.amp > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - over, cy, tw + over * 2, capH);
      ctx.clip();
      ctx.fillStyle = sky.accent;
      for (let k = -2; k < 8; k++) {
        const sx = x - over + k * capH * 1.4;
        ctx.beginPath();
        ctx.moveTo(sx, cy + capH);
        ctx.lineTo(sx + capH * 0.7, cy + capH);
        ctx.lineTo(sx + capH * 1.4, cy);
        ctx.lineTo(sx + capH * 0.7, cy);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // A warning light on the tip of each part.
    const ly = dir < 0 ? cy + capH : cy;
    ctx.fillStyle = blink ? sky.accent : shade(sky.accent, -0.25);
    ctx.beginPath();
    ctx.arc(x + tw / 2, ly + dir * capH * 0.15, Math.max(2, capH * 0.32), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The three-bar reception icon, outlined so it reads on any sky. */
function drawBar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const bw = r * 0.52;
  const gap = r * 0.2;
  const total = bw * 3 + gap * 2;
  const base = cy + r * 0.95;
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.strokeStyle = shade(color, -0.6);
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const hgt = r * (0.7 + i * 0.6);
    const x = cx - total / 2 + i * (bw + gap);
    ctx.strokeRect(x, base - hgt, bw, hgt);
    ctx.fillRect(x, base - hgt, bw, hgt);
  }
}

function drawGround(ctx: CanvasRenderingContext2D, w: number, h: number, gy: number, sky: SkyArt, scrollPx: number) {
  ctx.fillStyle = sky.ground;
  ctx.fillRect(0, gy, w, h - gy);
  ctx.fillStyle = shade(sky.ground, 0.2);
  ctx.fillRect(0, gy, w, Math.max(2, (h - gy) * 0.12));
  // Marks that scroll with the course, so speed reads at a glance.
  const step = w / 8;
  ctx.fillStyle = shade(sky.ground, -0.25);
  for (let x = -mod(scrollPx, step); x < w; x += step) ctx.fillRect(x, gy + (h - gy) * 0.45, step * 0.4, Math.max(2, (h - gy) * 0.14));
}

// ---------------------------------------------------------------------------
// Trail and drone
// ---------------------------------------------------------------------------

function drawTrail(ctx: CanvasRenderingContext2D, f: Frame, trail: TrailArt, s: number, y0: number, light: boolean) {
  if (trail.style === "none" || f.trail.length < 2) return;
  const g = f.game;
  const sp = Math.max(f.lastSpeed, 1) * s;
  const x0 = rules.drone_x * s - rules.drone_r * s * 0.9;
  const n = Math.min(f.trail.length, light ? 14 : trail.style === "comet" ? 16 : 30);
  const at = (k: number): [number, number] => [x0 - k * sp, k === 0 ? y0 : f.trail[k] * s];
  const fade = (k: number) => Math.max(0, 1 - k / n);
  const every = (k: number, m: number) => mod(g.tick - k, m) === 0;
  ctx.save();
  if (trail.style === "comet") {
    for (let k = 0; k < n - 1; k++) {
      const [ax, ay] = at(k);
      const [bx, by] = at(k + 1);
      ctx.strokeStyle = alphaOf(trail.color, 0.85 * fade(k));
      ctx.lineWidth = Math.max(1, rules.drone_r * s * 1.1 * fade(k));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  for (let k = 1; k < n; k++) {
    const [x, y] = at(k);
    const a = fade(k);
    const r = rules.drone_r * s;
    switch (trail.style) {
      case "waves":
        if (!every(k, 7)) break;
        ctx.strokeStyle = alphaOf(trail.color, 0.8 * a);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + r * 0.6, y, r * (0.5 + k * 0.05), Math.PI * 0.7, Math.PI * 1.3);
        ctx.stroke();
        break;
      case "sparks":
        if (!every(k, 2)) break;
        ctx.fillStyle = alphaOf(trail.color, a);
        ctx.fillRect(x + ((hash(g.tick - k, 1) % 7) - 3), y + ((hash(g.tick - k, 2) % 9) - 4), 2.5, 2.5);
        break;
      case "dots":
        if (!every(k, 4)) break;
        ctx.fillStyle = alphaOf(trail.color, a);
        ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
        break;
      case "static":
        if (!every(k, 2)) break;
        ctx.fillStyle = alphaOf(trail.color, 0.8 * a);
        ctx.fillRect(x - 3, y + ((hash(g.tick - k, 3) % 11) - 5), 6 + (hash(g.tick - k, 4) % 5), 1.5);
        break;
      case "bubbles":
        if (!every(k, 5)) break;
        ctx.strokeStyle = alphaOf(trail.color, 0.9 * a);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y - k * 0.4, 2 + k * 0.12, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "stars": {
        if (!every(k, 5)) break;
        ctx.fillStyle = alphaOf(trail.color, a);
        const q = 3.2;
        ctx.beginPath();
        ctx.moveTo(x, y - q);
        ctx.lineTo(x + q * 0.3, y - q * 0.3);
        ctx.lineTo(x + q, y);
        ctx.lineTo(x + q * 0.3, y + q * 0.3);
        ctx.lineTo(x, y + q);
        ctx.lineTo(x - q * 0.3, y + q * 0.3);
        ctx.lineTo(x - q, y);
        ctx.lineTo(x - q * 0.3, y - q * 0.3);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }
  ctx.restore();
}

/** The drone, centred on (0, 0) with radius `r`, already rotated. */
function drawDroneBody(ctx: CanvasRenderingContext2D, a: DroneArt, r: number, spin: number, lit: boolean) {
  const dark = shade(a.body, -0.4);
  // Radio mast at the back with a tip.
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(-r * 0.55, -r * 0.35);
  ctx.lineTo(-r * 0.85, -r * 1.15);
  ctx.stroke();
  ctx.fillStyle = a.light;
  ctx.fillRect(-r * 0.85 - r * 0.1, -r * 1.15 - r * 0.1, r * 0.2, r * 0.2);

  // Rotor on top: mast and a blade that spins (its visible length changes).
  ctx.fillStyle = dark;
  ctx.fillRect(-r * 0.07, -r * 0.95, r * 0.14, r * 0.4);
  const blade = r * 1.25 * Math.max(0.2, Math.abs(Math.cos(spin)));
  ctx.fillStyle = a.rotor;
  ctx.fillRect(-blade, -r * 1.05, blade * 2, Math.max(1.5, r * 0.14));

  ctx.fillStyle = a.body;
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  switch (a.style) {
    case "box":
      ctx.rect(-r * 1.05, -r * 0.6, r * 2.1, r * 1.25);
      break;
    case "pixel": {
      const p = r / 3;
      ctx.rect(-p * 3, -p * 2, p * 6, p * 4);
      ctx.rect(-p * 2, p * 2, p, p);
      ctx.rect(p, p * 2, p, p);
      break;
    }
    case "kite":
      ctx.moveTo(-r * 1.2, 0);
      ctx.lineTo(0, -r * 0.75);
      ctx.lineTo(r * 1.2, 0);
      ctx.lineTo(0, r * 0.75);
      ctx.closePath();
      break;
    case "wing":
      ctx.moveTo(-r * 1.3, -r * 0.1);
      ctx.lineTo(r * 1.15, -r * 0.45);
      ctx.lineTo(r * 1.0, r * 0.35);
      ctx.lineTo(-r * 0.9, r * 0.55);
      ctx.closePath();
      break;
    case "prism":
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i;
        const px = Math.cos(ang) * r * 1.05;
        const py = Math.sin(ang) * r * 0.8;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    default:
      ctx.ellipse(0, 0, r * 1.1, r * 0.75, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (a.style === "kite") {
    ctx.beginPath();
    ctx.moveTo(-r * 1.2, 0);
    ctx.lineTo(r * 1.2, 0);
    ctx.moveTo(0, -r * 0.75);
    ctx.lineTo(0, r * 0.75);
    ctx.stroke();
  }
  if (a.style === "prism") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.7);
    ctx.lineTo(r * 0.2, -r * 0.7);
    ctx.lineTo(-r * 0.2, r * 0.1);
    ctx.closePath();
    ctx.fill();
  }
  // The camera eye / status light at the front.
  ctx.fillStyle = lit ? a.light : shade(a.light, -0.45);
  const eye = a.style === "beacon" ? r * 0.38 : r * 0.26;
  if (a.style === "pixel") ctx.fillRect(r * 0.35, -r * 0.35, eye * 1.6, eye * 1.6);
  else {
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.05, eye, 0, Math.PI * 2);
    ctx.fill();
  }
  if (a.style === "beacon") {
    // The beacon's big lamp on top.
    ctx.fillStyle = lit ? a.light : shade(a.light, -0.4);
    ctx.beginPath();
    ctx.arc(0, -r * 0.62, r * 0.28, Math.PI, 0);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, f: Frame, look: Look): void {
  const g = f.game;
  const r = rules;
  const h = boardHeight(w);
  const s = w / r.width;
  const gy = groundY() * s;
  const back = (1 - f.alpha) * f.lastSpeed;
  const scroll = f.scroll - back;
  drawSky(ctx, w, h, gy, look.sky, scroll * s, look.light, f.time);

  const blink = look.light || Math.floor(f.time / 600) % 2 === 0;
  for (const t of g.towers) {
    const x = (t.x + back) * s;
    if (x > w || x + r.tower_w * s < 0) continue;
    drawTower(ctx, t, x, s, gy, look.sky, look.light, blink);
  }

  const bob = look.light ? 0 : Math.sin(f.time / 260) * 1.5;
  for (const b of g.bars) {
    const x = (b.x + back) * s;
    if (x < -20 || x > w + 20) continue;
    drawBar(ctx, x, b.y * s + bob, r.bars.r * s * 1.3, look.sky.accent);
  }

  drawGround(ctx, w, h, gy, look.sky, scroll * s);

  // The drone (smooth between ticks; a gentle bob while it waits to start).
  let y = (f.prevY + (g.y - f.prevY) * f.alpha) * s;
  if (!g.started && !look.light) y += Math.sin(f.time / 300) * r.drone_r * s * 0.25;
  drawTrail(ctx, f, look.trail, s, y, look.light);
  // Drawn a little bigger than its hitbox (collisions stay as fair or kinder).
  const rad = r.drone_r * s * 1.35;
  const tilt = g.started ? Math.max(-0.45, Math.min(0.6, (g.vy / r.max_fall) * 0.6)) : 0;
  ctx.save();
  ctx.translate(r.drone_x * s, y);
  ctx.rotate(g.over === "crash" ? 0.9 : tilt);
  const spin = look.light || g.over !== null ? 0 : f.time * 0.045;
  const lit = g.over === "crash" ? false : look.light || Math.floor(f.time / 450) % 3 !== 0;
  drawDroneBody(ctx, look.drone, rad, spin, lit);
  ctx.restore();

  f.bursts?.draw(ctx);

  if (f.showScore) {
    ctx.font = `${Math.max(14, w * 0.075)}px "Press Start 2P", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const text = String(g.s.score);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillText(text, w / 2 + 3, h * 0.05 + 3);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, w / 2, h * 0.05);
  }
}
