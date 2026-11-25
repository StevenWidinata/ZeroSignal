/**
 * Draws a Brick Breaker board on a canvas: the backdrop, bricks in the chosen
 * theme (cracks on tough bricks, rivets on steel, a fuse on explosive ones),
 * falling drops, laser bolts, the paddle, the balls and sparks. Drawing only:
 * it never changes the game.
 */
import type { Bursts } from "../../platform/burst";
import { rules, type Brick, type Game } from "./engine";
import type { BackdropArt, BallArt, PaddleArt, ThemeArt } from "./items";
import { DROP_INFO } from "./modes";

export interface Look {
  paddle: PaddleArt;
  ball: BallArt;
  theme: ThemeArt;
  backdrop: BackdropArt;
  /** Light graphics: no backdrop detail, no ball tails. */
  light: boolean;
}

export interface Frame {
  game: Game;
  /** Paddle x and ball positions before the last tick (for smooth motion). */
  prevPaddle: number;
  prevBalls: [number, number][];
  /** 0..1: how far into the current tick we are. */
  alpha: number;
  /** Real time in ms (for the fuse flicker). */
  time: number;
  bursts: Bursts | null;
}

/** Board height for a board `w` pixels wide. */
export const boardHeight = (w: number) => (w * rules.height) / rules.width;

/** Tiny deterministic hash for star fields and speckles. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** `#rrggbb` mixed toward black (amt < 0) or white (amt > 0). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt),
  );
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, a: BackdropArt, light: boolean) {
  ctx.fillStyle = a.bg;
  ctx.fillRect(0, 0, w, h);
  const s = w / rules.width;
  if (!light) {
    ctx.strokeStyle = a.line;
    ctx.fillStyle = a.line;
    ctx.lineWidth = 1;
    switch (a.style) {
      case "grid": {
        const step = rules.brick_w * s;
        ctx.beginPath();
        for (let x = step; x < w; x += step) {
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, h);
        }
        for (let y = step; y < h; y += step) {
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(w, Math.round(y) + 0.5);
        }
        ctx.stroke();
        break;
      }
      case "dots": {
        const step = (rules.brick_w * s) / 2;
        for (let x = step; x < w; x += step) for (let y = step; y < h; y += step) ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
        break;
      }
      case "horizon": {
        // Low sun bands near the bottom.
        const base = h * 0.78;
        for (let i = 0; i < 7; i++) {
          const y = base + i * i * (h * 0.006) + i * 6;
          ctx.globalAlpha = 0.55 - i * 0.06;
          ctx.fillRect(0, Math.round(y), w, 2);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "stars":
        for (let i = 0; i < 90; i++) {
          const hx = hash(i, 7);
          ctx.globalAlpha = 0.35 + ((hx >>> 8) % 60) / 100;
          ctx.fillStyle = (hx & 7) === 0 ? a.wall : "#ffffff";
          const sz = (hx & 3) === 0 ? 2 : 1;
          ctx.fillRect((hx % 1000) / 1000 * w, ((hx >>> 10) % 1000) / 1000 * h, sz, sz);
        }
        ctx.globalAlpha = 1;
        break;
      case "aurora":
        ctx.lineWidth = Math.max(6, w * 0.05);
        ctx.lineCap = "round";
        for (let band = 0; band < 3; band++) {
          ctx.globalAlpha = 0.16 - band * 0.04;
          ctx.strokeStyle = band === 1 ? a.line : a.wall;
          ctx.beginPath();
          for (let x = -20; x <= w + 20; x += 12) {
            const y = h * (0.18 + band * 0.1) + Math.sin(x / (w * 0.18) + band * 1.7) * h * 0.04;
            if (x === -20) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.lineCap = "butt";
        ctx.lineWidth = 1;
        break;
      case "circuit": {
        const step = rules.brick_w * s;
        ctx.beginPath();
        for (let i = 0; i < 26; i++) {
          const hx = hash(i, 31);
          const x0 = Math.round(((hx % 12) + 0.5) * step) + 0.5;
          const y0 = Math.round((((hx >>> 4) % 16) + 0.5) * step) + 0.5;
          const len = (2 + ((hx >>> 9) % 3)) * step;
          ctx.moveTo(x0, y0);
          if (hx & 1) ctx.lineTo(x0 + len, y0);
          else ctx.lineTo(x0, y0 + len);
          ctx.fillRect(x0 - 2, y0 - 2, 4, 4);
        }
        ctx.stroke();
        break;
      }
      case "plain":
        break;
    }
  }
  // The walls: top, left and right (the bottom is open).
  ctx.fillStyle = a.wall;
  const t = Math.max(2, Math.round(w / 160));
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, 0, w, t);
  ctx.fillRect(0, 0, t, h);
  ctx.fillRect(w - t, 0, t, h);
  ctx.globalAlpha = 1;
}

function brickColor(b: Brick, th: ThemeArt): string {
  if (b.kind === "s") return th.steel;
  if (b.kind === "e") return th.explosive;
  if (b.kind === "t") return b.max_hp >= 3 ? shade(th.tough, -0.25) : th.tough;
  const row = Math.round((b.y - rules.top) / rules.brick_h);
  return th.rows[((row % th.rows.length) + th.rows.length) % th.rows.length];
}

function drawBrick(ctx: CanvasRenderingContext2D, b: Brick, s: number, th: ThemeArt, time: number) {
  const gap = Math.max(1, Math.round(s * 160));
  const x = b.x * s + gap / 2;
  const y = b.y * s + gap / 2;
  const w = b.w * s - gap;
  const h = b.h * s - gap;
  const col = brickColor(b, th);
  const radius = th.style === "pixel" ? 0 : th.style === "glass" ? h * 0.35 : h * 0.18;

  ctx.globalAlpha = th.style === "glass" ? 0.82 : 1;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Material: a lit top edge and a darker bottom edge.
  if (th.style === "pixel") {
    ctx.fillStyle = shade(col, -0.35);
    ctx.fillRect(x, y + h - Math.max(2, h * 0.18), w, Math.max(2, h * 0.18));
    ctx.fillStyle = shade(col, 0.35);
    ctx.fillRect(x, y, w, Math.max(1, h * 0.12));
  } else if (th.style === "metal") {
    ctx.fillStyle = shade(col, 0.45);
    ctx.fillRect(x + radius, y + 1, w - radius * 2, Math.max(1, h * 0.16));
    ctx.fillStyle = shade(col, -0.3);
    ctx.fillRect(x + radius, y + h - Math.max(1, h * 0.16) - 1, w - radius * 2, Math.max(1, h * 0.16));
  } else if (th.style === "glass") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    roundRect(ctx, x + w * 0.08, y + h * 0.14, w * 0.5, h * 0.2, h * 0.1);
    ctx.fill();
  } else if (th.style === "stripes") {
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = Math.max(2, h * 0.22);
    ctx.beginPath();
    for (let i = -h; i < w + h; i += h * 0.9) {
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + h, y);
    }
    ctx.stroke();
    ctx.restore();
  } else if (th.style === "rock") {
    const n = Math.round(b.x / 100) * 13 + Math.round(b.y / 100);
    ctx.fillStyle = shade(col, 0.25);
    for (let i = 0; i < 6; i++) {
      const hx = hash(n, i);
      ctx.fillRect(x + ((hx % 100) / 100) * (w - 3), y + (((hx >>> 8) % 100) / 100) * (h - 3), 2, 2);
    }
    if (th.glow) {
      ctx.fillStyle = th.glow;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x + radius, y + h - 2, w - radius * 2, 1.5);
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fillRect(x + radius, y + 1, w - radius * 2, Math.max(1, h * 0.14));
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(x + radius, y + h - Math.max(1, h * 0.14) - 1, w - radius * 2, Math.max(1, h * 0.14));
  }

  // What kind it is.
  ctx.lineWidth = Math.max(1, h * 0.09);
  if (b.kind === "t" && b.hp < b.max_hp) {
    // A crack per hit taken.
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    const hits = b.max_hp - b.hp;
    for (let i = 0; i < hits; i++) {
      const cx = x + w * (0.3 + 0.38 * i);
      ctx.moveTo(cx, y + 1);
      ctx.lineTo(cx + w * 0.06, y + h * 0.45);
      ctx.lineTo(cx - w * 0.04, y + h * 0.62);
      ctx.lineTo(cx + w * 0.05, y + h - 1);
    }
    ctx.stroke();
  } else if (b.kind === "t") {
    // A double outline says "takes more than one hit".
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    roundRect(ctx, x + h * 0.2, y + h * 0.2, w - h * 0.4, h - h * 0.4, Math.max(0, radius - h * 0.2));
    ctx.stroke();
  } else if (b.kind === "s") {
    ctx.fillStyle = shade(col, 0.4);
    const r = Math.max(1, h * 0.09);
    for (const [fx, fy] of [
      [0.1, 0.3],
      [0.9, 0.3],
      [0.1, 0.7],
      [0.9, 0.7],
    ]) {
      ctx.beginPath();
      ctx.arc(x + w * fx, y + h * fy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (b.kind === "e") {
    // A fuse mark that flickers a little.
    const on = Math.floor(time / 260 + b.x / 4000) % 2 === 0;
    ctx.fillStyle = on ? "#FFE8A3" : "#FFFFFF";
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = h * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }
  if (b.drop && b.kind !== "s") {
    // A small dot in the drop's color: this brick holds something.
    ctx.fillStyle = DROP_INFO[b.drop].color;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + w - h * 0.32, y + h * 0.32, Math.max(1.5, h * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawPaddle(ctx: CanvasRenderingContext2D, g: Game, px: number, s: number, a: PaddleArt) {
  const r = rules;
  const w = g.paddleW() * s;
  const h = r.paddle_h * s;
  const x = px * s - w / 2;
  const y = r.paddle_y * s;
  const rad = a.style === "pixel" ? 0 : h / 2;
  roundRect(ctx, x, y, w, h, rad);
  ctx.fillStyle = a.color;
  ctx.fill();
  switch (a.style) {
    case "wood":
      ctx.strokeStyle = "rgba(60, 30, 10, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.1, y + h * 0.4);
      ctx.lineTo(x + w * 0.9, y + h * 0.45);
      ctx.moveTo(x + w * 0.2, y + h * 0.7);
      ctx.lineTo(x + w * 0.75, y + h * 0.68);
      ctx.stroke();
      break;
    case "pixel":
      ctx.fillStyle = a.edge;
      ctx.fillRect(x, y, w, Math.max(2, h * 0.25));
      ctx.fillStyle = shade(a.color, -0.35);
      ctx.fillRect(x, y + h - Math.max(2, h * 0.25), w, Math.max(2, h * 0.25));
      break;
    case "neon":
      ctx.strokeStyle = a.edge;
      ctx.lineWidth = Math.max(1.5, h * 0.16);
      roundRect(ctx, x + 1, y + 1, w - 2, h - 2, rad);
      ctx.stroke();
      break;
    case "glass":
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      roundRect(ctx, x + w * 0.08, y + h * 0.15, w * 0.6, h * 0.28, h * 0.14);
      ctx.fill();
      break;
    default:
      ctx.fillStyle = a.edge;
      roundRect(ctx, x + rad * 0.6, y + h * 0.12, w - rad * 1.2, Math.max(1.5, h * 0.22), h * 0.11);
      ctx.fill();
  }
  if (g.laser > 0) {
    // Two cannons at the ends.
    ctx.fillStyle = "#F2994A";
    const cw = Math.max(3, h * 0.45);
    const off = (g.paddleW() / 2 - r.ball_r) * s;
    ctx.fillRect(px * s - off - cw / 2, y - h * 0.5, cw, h * 0.6);
    ctx.fillRect(px * s + off - cw / 2, y - h * 0.5, cw, h * 0.6);
  }
  if (g.sticky > 0) {
    ctx.fillStyle = "#C9A227";
    ctx.fillRect(x + rad, y - Math.max(1.5, h * 0.18), w - rad * 2, Math.max(1.5, h * 0.18));
  }
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, a: BallArt, light: boolean, dir: [number, number]) {
  if (a.style === "tail" && !light && (dir[0] !== 0 || dir[1] !== 0)) {
    const len = Math.hypot(dir[0], dir[1]) || 1;
    ctx.fillStyle = a.color;
    for (let i = 1; i <= 4; i++) {
      ctx.globalAlpha = 0.3 - i * 0.06;
      ctx.beginPath();
      ctx.arc(x - (dir[0] / len) * rad * 1.3 * i, y - (dir[1] / len) * rad * 1.3 * i, rad * (1 - i * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (a.style === "pixel") {
    ctx.fillStyle = a.color;
    ctx.fillRect(x - rad, y - rad * 0.6, rad * 2, rad * 1.2);
    ctx.fillRect(x - rad * 0.6, y - rad, rad * 1.2, rad * 2);
    ctx.fillStyle = a.edge;
    ctx.fillRect(x + rad * 0.1, y + rad * 0.2, rad * 0.5, rad * 0.5);
    return;
  }
  if (a.style === "rays") {
    ctx.strokeStyle = a.edge;
    ctx.lineWidth = Math.max(1, rad * 0.25);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const t = (Math.PI / 4) * i;
      ctx.moveTo(x + Math.cos(t) * rad * 1.15, y + Math.sin(t) * rad * 1.15);
      ctx.lineTo(x + Math.cos(t) * rad * 1.55, y + Math.sin(t) * rad * 1.55);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fillStyle = a.color;
  ctx.fill();
  switch (a.style) {
    case "ring":
      ctx.strokeStyle = a.edge;
      ctx.lineWidth = Math.max(1, rad * 0.35);
      ctx.stroke();
      break;
    case "swirl":
      ctx.strokeStyle = a.edge;
      ctx.lineWidth = Math.max(1, rad * 0.22);
      ctx.beginPath();
      ctx.arc(x - rad * 0.2, y, rad * 0.55, -0.4, Math.PI * 1.2);
      ctx.stroke();
      break;
    case "facets":
      ctx.fillStyle = a.edge;
      ctx.fillRect(x - rad * 0.55, y - rad * 0.55, rad * 0.45, rad * 0.45);
      ctx.fillRect(x + rad * 0.1, y + rad * 0.1, rad * 0.45, rad * 0.45);
      break;
    default:
      ctx.fillStyle = a.edge;
      ctx.beginPath();
      ctx.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.32, 0, Math.PI * 2);
      ctx.fill();
  }
}

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, f: Frame, look: Look): void {
  const g = f.game;
  const r = rules;
  const h = boardHeight(w);
  const s = w / r.width;
  drawBackdrop(ctx, w, h, look.backdrop, look.light);

  for (const b of g.bricks) if (b.alive) drawBrick(ctx, b, s, look.theme, f.time);

  // Drops: capsules with a letter.
  const dw = r.drop_w * s;
  const dh = r.drop_h * s;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(8, dh * 0.78)}px system-ui, sans-serif`;
  for (const d of g.drops) {
    const info = DROP_INFO[d.kind];
    const x = d.x * s - dw / 2;
    const y = d.y * s - dh / 2;
    roundRect(ctx, x, y, dw, dh, dh / 2);
    ctx.fillStyle = info.color;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(info.letter, d.x * s, d.y * s + 0.5);
  }

  // Laser bolts.
  ctx.fillStyle = "#FFB46B";
  for (const bo of g.bolts) ctx.fillRect((bo.x - r.laser_w / 2) * s, bo.y * s, Math.max(1.5, r.laser_w * s), r.laser_h * s);

  const px = g.over !== null ? g.paddle_x : f.prevPaddle + (g.paddle_x - f.prevPaddle) * f.alpha;
  drawPaddle(ctx, g, px, s, look.paddle);

  const same = f.prevBalls.length === g.balls.length;
  g.balls.forEach((b, i) => {
    const [ox, oy] = same && b.stuck === null ? f.prevBalls[i] : [b.x, b.y];
    const bx = ox + (b.x - ox) * f.alpha;
    const by = oy + (b.y - oy) * f.alpha;
    drawBall(ctx, bx * s, by * s, Math.max(3, r.ball_r * s), look.ball, look.light, [b.x - ox, b.y - oy]);
  });

  f.bursts?.draw(ctx);
}
