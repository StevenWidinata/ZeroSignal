/**
 * Draws a Snake Signal board on a canvas: arena, walls, packets, power-ups,
 * glitch blocks, the bug, the gliding neon snake and sparks. Drawing only:
 * it never changes the game.
 */
import type { Bursts } from "../../platform/burst";
import { rules, type Game, type Power } from "./engine";
import type { ArenaArt, SkinArt } from "./items";

export interface Look {
  skin: SkinArt;
  arena: ArenaArt;
  /** Light graphics: no glow, no static noise. */
  light: boolean;
}

export interface Frame {
  game: Game;
  /** The snake before the last tick (for smooth gliding). */
  prev: number[];
  /** 0..1: how far into the current tick we are. */
  alpha: number;
  /** Real time in ms (for pulses and flicker). */
  time: number;
  bursts: Bursts | null;
}

export const POWER_ICON: Record<Power, string> = { boost: "⚡", phase: "👻", magnet: "🧲", slow: "⏳", snip: "✂️" };
export const POWER_NAME: Record<Power, string> = {
  boost: "Boost ×2",
  phase: "Phase",
  magnet: "Magnet",
  slow: "Slow-mo",
  snip: "Snip",
};
const BOOST_GLOW = "#FFD84D";

/** Tiny deterministic hash for star fields and static noise. */
function hash(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function drawArena(ctx: CanvasRenderingContext2D, px: number, n: number, a: ArenaArt, wraps: boolean, time: number) {
  const cell = px / n;
  ctx.fillStyle = a.bg;
  ctx.fillRect(0, 0, px, px);
  ctx.strokeStyle = a.line;
  ctx.fillStyle = a.line;
  ctx.lineWidth = 1;
  switch (a.style) {
    case "grid":
    case "circuit":
    case "horizon": {
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        ctx.moveTo(i * cell + 0.5, 0);
        ctx.lineTo(i * cell + 0.5, px);
        ctx.moveTo(0, i * cell + 0.5);
        ctx.lineTo(px, i * cell + 0.5);
      }
      ctx.stroke();
      if (a.style === "circuit") {
        for (let c = 0; c < n * n; c++) {
          if (hash(c, 7) % 9 !== 0) continue;
          const x = (c % n) * cell;
          const y = Math.trunc(c / n) * cell;
          ctx.fillRect(x - 2, y - 2, 4, 4);
        }
      }
      if (a.style === "horizon") {
        const g = ctx.createLinearGradient(0, 0, 0, px);
        g.addColorStop(0, "rgba(255,63,164,0.18)");
        g.addColorStop(1, "rgba(63,240,255,0.10)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, px, px);
      }
      break;
    }
    case "dots":
      for (let y = 1; y < n; y++) for (let x = 1; x < n; x++) ctx.fillRect(x * cell - 1, y * cell - 1, 2, 2);
      break;
    case "checker":
      for (let c = 0; c < n * n; c++) {
        if (((c % n) + Math.trunc(c / n)) % 2 === 0) ctx.fillRect((c % n) * cell, Math.trunc(c / n) * cell, cell, cell);
      }
      break;
    case "stars":
      for (let i = 0; i < n * 3; i++) {
        const h = hash(i, 99);
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(time / 900 + i));
        ctx.globalAlpha = tw;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect((h % 1000) / 1000 * px, (Math.trunc(h / 1000) % 1000) / 1000 * px, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
      break;
  }
  // Walls (Classic / Daily) or portal edges (Wrap).
  ctx.strokeStyle = a.wall;
  ctx.lineWidth = 4;
  if (wraps) {
    ctx.setLineDash([cell * 0.6, cell * 0.4]);
    ctx.lineDashOffset = -time / 40;
    ctx.globalAlpha = 0.7;
  }
  ctx.strokeRect(2, 2, px - 4, px - 4);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** Ring showing how long an item stays (1 = full). */
function timeRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, left: number, color: string) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, left)));
  ctx.stroke();
}

export function drawFrame(ctx: CanvasRenderingContext2D, px: number, f: Frame, look: Look) {
  const g = f.game;
  const n = g.n;
  const cell = px / n;
  const center = (c: number): [number, number] => [((c % n) + 0.5) * cell, (Math.trunc(c / n) + 0.5) * cell];
  const glow = (color: string, blur: number) => {
    if (look.light) return;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  };
  const noGlow = () => {
    ctx.shadowBlur = 0;
  };

  drawArena(ctx, px, n, look.arena, g.mode === "wrap", f.time);

  // Glitch blocks: flicker as a warning, then solid static.
  for (const b of g.blocks) {
    const [x, y] = center(b.cell);
    const solid = g.solidAt(b.cell);
    if (!solid) {
      if (Math.trunc(f.time / 120) % 2 === 0) {
        ctx.strokeStyle = "#ff3f5e";
        ctx.lineWidth = 2;
        ctx.strokeRect(x - cell / 2 + 2, y - cell / 2 + 2, cell - 4, cell - 4);
        ctx.fillStyle = "#ff3f5e";
        ctx.font = `bold ${Math.round(cell * 0.6)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", x, y + 1);
      }
      continue;
    }
    ctx.fillStyle = "#24242e";
    ctx.fillRect(x - cell / 2, y - cell / 2, cell, cell);
    const q = cell / 4;
    const frame = look.light ? 0 : Math.trunc(f.time / 90);
    for (let i = 0; i < 16; i++) {
      const v = hash(b.cell * 16 + i, frame) % 200;
      ctx.fillStyle = `rgb(${v},${v},${v + 30})`;
      ctx.fillRect(x - cell / 2 + (i % 4) * q, y - cell / 2 + Math.trunc(i / 4) * q, q, q);
    }
    ctx.strokeStyle = "#ff3f5e";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - cell / 2 + 0.5, y - cell / 2 + 0.5, cell - 1, cell - 1);
  }

  // Data packet (diamond).
  {
    const [x, y] = center(g.food);
    const s = cell * (0.32 + 0.04 * Math.sin(f.time / 160));
    glow(look.arena.food, cell * 0.8);
    ctx.fillStyle = look.arena.food;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fill();
    noGlow();
  }

  // Golden packet (star + time ring).
  if (g.golden) {
    const [x, y] = center(g.golden.cell);
    glow("#ffd84d", cell);
    ctx.fillStyle = "#ffd84d";
    star(ctx, x, y, cell * 0.42);
    noGlow();
    timeRing(ctx, x, y, cell * 0.5, (g.golden.until - g.tick) / rules.golden_ticks, "#ffd84d");
  }

  // Power-up (rounded tile with an icon + time ring).
  if (g.power) {
    const [x, y] = center(g.power.cell);
    const s = cell * 0.44;
    glow("#ffffff", cell * 0.6);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.roundRect(x - s, y - s, s * 2, s * 2, s * 0.4);
    ctx.fill();
    noGlow();
    ctx.font = `${Math.round(cell * 0.62)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(POWER_ICON[g.power.kind], x, y + 1);
    timeRing(ctx, x, y, cell * 0.58, (g.power.until - g.tick) / rules.power_ticks, "#ffffff");
  }

  // The glitch bug (edible while Boosted).
  if (g.bug) {
    const [x, y] = center(g.bug.cell);
    const edible = g.tick < g.boostUntil;
    // Red = deadly, green = edible (Boosted); the icon is the same either way.
    const ring = edible ? "#2ee88a" : "#ff3f5e";
    glow(ring, cell);
    ctx.fillStyle = edible ? "rgba(46,232,138,0.45)" : "rgba(255,63,94,0.35)";
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.stroke();
    noGlow();
    const jitter = look.light ? 0 : Math.sin(f.time / 50) * cell * 0.05;
    ctx.font = `${Math.round(cell * 0.85)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👾", x + jitter, y + 1);
  }

  // The snake, gliding from its last position.
  const cur = g.snake;
  const skin = look.skin;
  // Retro pixel skin steps from cell to cell; the others glide.
  const pts: [number, number][] = cur.map((to, i) => {
    if (skin.style === "pixel") return center(to);
    const from = f.prev[i] ?? f.prev[f.prev.length - 1] ?? to;
    const [ax, ay] = center(from);
    const [bx, by] = center(to);
    // Through a portal: don't slide across the whole board.
    if (Math.abs(ax - bx) > cell * 1.5 || Math.abs(ay - by) > cell * 1.5) return [bx, by];
    return [ax + (bx - ax) * f.alpha, ay + (by - ay) * f.alpha];
  });
  const boosted = g.tick < g.boostUntil;
  const phasing = g.tick < g.phaseUntil;
  ctx.globalAlpha = phasing ? 0.45 + 0.2 * Math.abs(Math.sin(f.time / 90)) : skin.style === "ghost" ? 0.78 : 1;
  glow(boosted ? BOOST_GLOW : skin.glow, cell * 0.7);
  const w = cell * 0.68;
  if (skin.style === "pixel") {
    ctx.fillStyle = skin.body;
    for (let i = pts.length - 1; i >= 1; i--) ctx.fillRect(pts[i][0] - w / 2, pts[i][1] - w / 2, w, w);
  } else {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = w;
    if (skin.style === "rainbow") {
      for (let i = pts.length - 1; i >= 1; i--) {
        const [a, b] = [pts[i], pts[i - 1]];
        if (Math.abs(a[0] - b[0]) > cell * 1.5 || Math.abs(a[1] - b[1]) > cell * 1.5) continue;
        ctx.strokeStyle = `hsl(${(i * 24 + f.time / 8) % 360} 95% 62%)`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = skin.body;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const p = pts[i - 1];
        if (i === 0 || Math.abs(p[0] - x) > cell * 1.5 || Math.abs(p[1] - y) > cell * 1.5) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
      ctx.stroke();
    }
  }
  noGlow();
  if (skin.style === "stripes" && skin.stripe) {
    ctx.fillStyle = skin.stripe;
    for (let i = 2; i < pts.length; i += 2) {
      ctx.beginPath();
      ctx.arc(pts[i][0], pts[i][1], w * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (skin.style === "circuit") {
    ctx.fillStyle = skin.head;
    for (let i = 1; i < pts.length; i++) ctx.fillRect(pts[i][0] - 1.5, pts[i][1] - 1.5, 3, 3);
  }
  // Head with eyes looking where it goes.
  {
    const [hx, hy] = pts[0];
    glow(boosted ? BOOST_GLOW : skin.glow, cell);
    ctx.fillStyle = skin.head;
    ctx.beginPath();
    if (skin.style === "pixel") ctx.rect(hx - cell * 0.43, hy - cell * 0.43, cell * 0.86, cell * 0.86);
    else ctx.arc(hx, hy, cell * 0.45, 0, Math.PI * 2);
    ctx.fill();
    noGlow();
    const dx = [0, 1, 0, -1][g.dir];
    const dy = [-1, 0, 1, 0][g.dir];
    const ex = -dy * cell * 0.18;
    const ey = dx * cell * 0.18;
    ctx.fillStyle = g.over && g.over !== "quit" && g.over !== "signal" ? "#ff3f5e" : "#10131c";
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.arc(hx + dx * cell * 0.15 + ex * s, hy + dy * cell * 0.15 + ey * s, cell * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Weak signal: the picture breaks up.
  if (!look.light && g.over === null && g.signal < 250) {
    const k = (250 - g.signal) / 250;
    const frame = Math.trunc(f.time / 70);
    for (let i = 0; i < 40 * k; i++) {
      const h = hash(i, frame);
      ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.25 * k})`;
      ctx.fillRect((h % 997) / 997 * px, (Math.trunc(h / 997) % 991) / 991 * px, cell * (0.5 + (h % 3)), 2);
    }
  }

  f.bursts?.draw(ctx);
}
