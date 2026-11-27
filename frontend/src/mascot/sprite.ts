/**
 * Ping the bat, Zero Signal's mascot, drawn as pixel art in code (no image files).
 *
 * Everything here is pure: a pose and a moment in time go in, a grid of colours
 * comes out. The sprite is drawn on a 44-wide grid, placed on a larger canvas
 * grid so effects (sonar rings, hearts, stars) have room around him. Every
 * sprite pixel gets a dark outline automatically.
 */

/** The sprite's own grid (Ping is drawn inside 44×44). */
export const SW = 44;

export const OUTLINE = "#0a0d1c";
const W = "#ffffff";

/** Ping's colours. */
export const COLORS = {
  body: "#4d68a6",
  bodyDark: "#3d5590",
  highlight: "#7b98d8",
  fur: "#93aeea",
  furDark: "#7a96d2",
  snout: "#6582bf",
  wing: "#34497e",
  wingDark: "#2a3c6b",
  bone: "#6a87c0",
  ear: "#ffd23f",
  earDark: "#e0a800",
  tongue: "#ff5a5f",
  blush: "#ff8fa3",
  cap: "#3a86ff",
  capDark: "#1d5fd8",
  ring: "#3bce7a",
  bar: "#8d97c9",
} as const;

export type Pose =
  | "hang"
  | "ping"
  | "echo"
  | "stretch"
  | "flap"
  | "flip"
  | "nap"
  | "dizzy"
  | "mope"
  | "look"
  | "wave";

export interface PingState {
  /** Seconds since start (drives slow idle motion). */
  t: number;
  /** The playing animation, or null for plain idle. */
  pose: Pose | null;
  /** Seconds into the pose. */
  at: number;
  /** Progress through the pose, 0..1. */
  k: number;
  blink: boolean;
  /** Where the eyes look. */
  look: -1 | 0 | 1;
  petting: boolean;
  /** Night owl: wears the nightcap. */
  night: boolean;
  /** Perched upside down (from the header). Tricks flip him upright for a moment. */
  hanging: boolean;
}

export const IDLE_STATE: PingState = {
  t: 0,
  pose: null,
  at: 0,
  k: 0,
  blink: false,
  look: 0,
  petting: false,
  night: false,
  hanging: false,
};

type Pt = [number, number];
export type Cell = string | null;

export class Painter {
  readonly size: number;
  sprite: Cell[];
  fx: Cell[];
  private layer: Cell[];
  dx = 0;
  dy = 0;
  flipX = false;
  flipY = false;

  /** `size`: canvas grid; `ox`/`oy`: where the sprite's top-left sits on it. */
  constructor(size: number, readonly ox: number, readonly oy: number) {
    this.size = size;
    this.sprite = new Array<Cell>(size * size).fill(null);
    this.fx = new Array<Cell>(size * size).fill(null);
    this.layer = this.sprite;
  }

  /** Draw effects (no outline, no flips) from now on. */
  toFx() {
    this.dx = this.dy = 0;
    this.flipX = this.flipY = false;
    this.layer = this.fx;
  }

  px(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (this.flipX) x = SW - x;
    if (this.flipY) y = SW - 1 - y;
    x += this.ox + this.dx;
    y += this.oy + this.dy;
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.layer[y * this.size + x] = c;
  }

  rect(x1: number, y1: number, x2: number, y2: number, c: string) {
    for (let y = Math.round(y1); y <= Math.round(y2); y++)
      for (let x = Math.round(x1); x <= Math.round(x2); x++) this.px(x, y, c);
  }

  ell(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x - cx) / rx;
        const v = (y - cy) / ry;
        if (u * u + v * v <= 1) this.px(x, y, c);
      }
  }

  tri(a: Pt, b: Pt, c: Pt, col: string) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-6) return;
    for (let y = Math.floor(Math.min(a[1], b[1], c[1])); y <= Math.ceil(Math.max(a[1], b[1], c[1])); y++)
      for (let x = Math.floor(Math.min(a[0], b[0], c[0])); x <= Math.ceil(Math.max(a[0], b[0], c[0])); x++) {
        const w0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
        const w1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
        if (w0 >= -0.02 && w1 >= -0.02 && 1 - w0 - w1 >= -0.02) this.px(x, y, col);
      }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }

  ring(cx: number, cy: number, r: number, c: string, dashed: boolean) {
    const n = Math.ceil(Math.PI * 2 * r * 1.4);
    for (let i = 0; i < n; i++) {
      if (dashed && i % 3 === 0) continue;
      const a = (i / n) * Math.PI * 2;
      this.px(cx + Math.cos(a) * r, cy + Math.sin(a) * r, c);
    }
  }

  glyph(x: number, y: number, g: Glyph) {
    g.rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch !== ".") this.px(x + i, y + j, g.color);
      }),
    );
  }

  /** Give every sprite pixel a dark outline. */
  outline() {
    const n = this.size;
    const src = this.sprite;
    const out = src.slice();
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && src[y * n + x];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (!src[y * n + x] && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) out[y * n + x] = OUTLINE;
    this.sprite = out;
  }
}

export interface Glyph {
  rows: string[];
  color: string;
}

export const GLYPHS = {
  heart: { rows: [".X.X.", "XXXXX", "XXXXX", ".XXX.", "..X.."], color: "#ff5a5f" },
  star: { rows: [".X.", "XXX", ".X."], color: "#ffd23f" },
  z: { rows: ["XXX", ".X.", "XXX"], color: COLORS.bar },
} satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;

const mirror = (m: boolean) => (x: number) => (m ? SW - x : x);

/** True when Ping is drawn upside down in this state. */
export function isUpsideDown(s: PingState): boolean {
  const base = s.hanging || s.pose === "hang" || s.pose === "nap";
  if (s.pose === "flap") return false;
  if (s.pose === "flip") return s.k > 0.3 && s.k < 0.7 ? !base : base;
  return base;
}

/** Where his head is on the sprite grid (effects and hearts start there). */
export function headY(s: PingState): number {
  return isUpsideDown(s) ? 30 : 4;
}

/** Draw Ping in the given state. */
export function drawPing(p: Painter, s: PingState) {
  const C = COLORS;
  const { pose, at, k } = s;
  let open = 0.12;
  let flap = 0;
  let earUp = 0;
  let earDroop = 0;
  let mouth: "smile" | "yawn" | "o" | "wobble" | "sad" = "smile";
  let eyes: "open" | "half" | "closed" | "happy" | "x" = "open";
  let wrap = false;

  p.flipY = isUpsideDown(s);
  if (pose === "hang" || pose === "nap") p.dx = Math.round(Math.sin(at * 2.2));
  else if (s.hanging) p.dx = Math.round(Math.sin(s.t * 1.1) * 0.6);
  if (pose === "ping" || pose === "echo") {
    earUp = 1;
    mouth = "o";
  }
  if (pose === "stretch") {
    open = Math.sin(k * Math.PI);
    if (k > 0.3 && k < 0.75) {
      mouth = "yawn";
      eyes = "closed";
    }
  }
  if (pose === "flap") {
    flap = Math.sin(at * 28);
    open = 0.85;
    p.dy = (s.hanging ? 1 : -1) * Math.round(Math.sin(k * Math.PI) * 9);
  }
  if (pose === "flip") {
    p.dy = (s.hanging ? 1 : -1) * Math.round(Math.sin(k * Math.PI) * 8);
    open = 0.6;
  }
  if (pose === "nap") {
    eyes = "closed";
    open = 0;
    mouth = "o";
  }
  if (pose === "dizzy") {
    eyes = "x";
    mouth = "wobble";
    p.dx = Math.round(Math.sin(at * 14));
  }
  if (pose === "mope") {
    wrap = true;
    open = 0;
    earDroop = 1;
    eyes = "half";
    mouth = "sad";
  }
  if (s.petting) {
    eyes = "happy";
    mouth = "smile";
    earDroop = 0;
    wrap = false;
  }
  if (s.blink && (eyes === "open" || eyes === "half")) eyes = "closed";

  // Waving: his right wing (screen left) up and swinging, the other folded.
  const waving = pose === "wave" && !s.petting;
  const wing = (front: boolean) => {
    for (const m of [false, true]) {
      const X = mirror(m);
      const wo = waving ? (m ? 0.12 : 0.95) : open;
      const wf = waving ? (m ? 0 : Math.sin(at * 7)) : flap;
      const S: Pt = [X(16), 27];
      let pts: Pt[] = front
        ? [[15, 24], [17, 30], [19, 36], [21, 39]]
        : [
            [12 - 11 * wo, 22 - 8 * wo + wf * 4],
            [10 - 9 * wo, 31 - 4 * wo + wf * 2],
            [12 - 6 * wo, 37 - wo + wf],
            [16, 39],
          ];
      pts = pts.map(([x, y]) => [X(x), y]);
      // Scalloped membrane: each panel dips toward the shoulder between two fingers.
      const dip = front ? 0 : 0.22 * Math.min(1, wo * 2);
      for (let i = 0; i < 3; i++) {
        const A = pts[i];
        const B = pts[i + 1];
        const mx = (A[0] + B[0]) / 2;
        const my = (A[1] + B[1]) / 2;
        const M: Pt = [mx + (S[0] - mx) * dip, my + (S[1] - my) * dip];
        const col = i === 2 ? C.wingDark : C.wing;
        p.tri(S, A, M, col);
        p.tri(S, M, B, col);
      }
      if (wo > 0.3) {
        for (let i = 0; i < 3; i++) p.line(S[0], S[1], pts[i][0], pts[i][1], C.bone);
        p.px(pts[0][0] + (m ? -1 : 1), pts[0][1] - 1, "#e8ecff");
      } else if (!front) {
        p.line(S[0] - (m ? -1 : 1), S[1] + 2, pts[2][0], pts[2][1] - 1, C.bone);
      }
    }
  };

  if (!wrap) wing(false);

  // Body, chest fluff, feet.
  p.ell(22, 32, 7, 6.5, C.body);
  p.ell(22, 33, 4.5, 5, C.fur);
  p.px(20, 28, C.fur);
  p.px(22, 28, C.fur);
  p.px(24, 28, C.fur);
  p.rect(20, 36, 24, 36, C.furDark);
  for (const X of [mirror(false), mirror(true)]) {
    p.rect(X(19), 39, X(19), 41, OUTLINE);
    p.px(X(18), 41, OUTLINE);
  }
  if (wrap) wing(true);

  // Ears.
  for (const m of [false, true]) {
    const X = mirror(m);
    p.tri([X(11 - earDroop * 2), 4 - earUp + earDroop * 4], [X(12), 17], [X(18), 12], C.body);
    p.tri([X(12.9 - earDroop * 2.5), 7 - earUp + earDroop * 4], [X(13.3), 15.5], [X(16.6), 12.8], C.ear);
    p.line(X(12.9 - earDroop * 2.5), 8 - earUp + earDroop * 4, X(13.3), 14.5, C.earDark);
  }

  // Head with a darker lower half, highlight and a tuft.
  p.ell(22, 19, 10, 8.5, C.bodyDark);
  p.ell(22, 18, 9.6, 7.6, C.body);
  p.ell(18, 13, 2.6, 1, C.highlight);
  p.px(21, 10, C.highlight);
  p.px(22, 9, C.body);
  p.px(23, 10, C.highlight);

  // Snout.
  p.ell(22, 23, 4, 2.4, C.snout);
  p.px(21, 22, OUTLINE);
  p.px(23, 22, OUTLINE);

  // Eyes.
  for (const side of [-1, 1]) {
    const x = side < 0 ? 14 : 27;
    const y = 16;
    if (eyes === "open" || eyes === "half") {
      p.rect(x, y, x + 3, y + 3, W);
      const lx = s.look === 0 ? 1 : s.look < 0 ? 0 : 2;
      p.rect(x + lx, y + 1, x + lx + 1, y + 3, OUTLINE);
      p.px(x + lx, y + 1, W);
      if (eyes === "half") {
        p.rect(x, y, x + 3, y + 1, C.body);
        p.rect(x, y + 1, x + 3, y + 1, OUTLINE);
      }
    } else if (eyes === "closed") {
      p.rect(x, y + 2, x + 3, y + 2, OUTLINE);
    } else if (eyes === "happy") {
      p.px(x, y + 3, OUTLINE);
      p.px(x + 1, y + 2, OUTLINE);
      p.px(x + 2, y + 2, OUTLINE);
      p.px(x + 3, y + 3, OUTLINE);
    } else {
      for (const [a, b] of [[0, 0], [3, 0], [1, 1], [2, 1], [1, 2], [2, 2], [0, 3], [3, 3]]) p.px(x + a, y + b, OUTLINE);
    }
  }

  // Mouth.
  if (mouth === "smile") {
    p.px(19, 25, OUTLINE);
    p.rect(20, 26, 24, 26, OUTLINE);
    p.px(25, 25, OUTLINE);
    p.px(20, 27, W);
    p.px(24, 27, W);
  } else if (mouth === "yawn") {
    p.rect(19, 25, 25, 29, OUTLINE);
    p.rect(20, 28, 24, 29, C.tongue);
    p.px(20, 25, W);
    p.px(24, 25, W);
  } else if (mouth === "o") {
    p.rect(21, 25, 23, 27, OUTLINE);
  } else if (mouth === "wobble") {
    [19, 20, 21, 22, 23, 24, 25].forEach((x, i) => p.px(x, 26 - (i % 2), OUTLINE));
  } else {
    p.px(19, 27, OUTLINE);
    p.rect(20, 26, 24, 26, OUTLINE);
    p.px(25, 27, OUTLINE);
  }

  if (s.petting) {
    p.rect(11, 22, 12, 22, C.blush);
    p.rect(32, 22, 33, 22, C.blush);
  }

  if (s.night) {
    const flop = Math.round(Math.sin(s.t * 1.5));
    p.tri([14, 12], [30, 12], [33 + flop, 2], C.cap);
    p.tri([22, 12], [30, 12], [33 + flop, 2], C.capDark);
    p.rect(14, 11, 30, 12, W);
    p.ell(34 + flop, 2, 1.6, 1.6, W);
  }
}

/** Effects around Ping (perch bar, sonar rings, dizzy stars). Call after `toFx()`. */
export function drawFx(p: Painter, s: PingState) {
  const { pose, at } = s;
  const down = isUpsideDown(s);
  // The bar he hangs from (it stays put while he flies off for a trick).
  if (s.hanging) p.rect(10, 0, 34, 1, COLORS.bar);
  else if (pose === "hang" || pose === "nap") p.rect(4, 0, 40, 1, COLORS.bar);
  if (pose === "ping" || pose === "echo") {
    const speed = pose === "echo" ? 16 : 11;
    for (let i = 0; i < 3; i++) {
      const r = ((at * speed + i * 6) % 20) + 3;
      p.ring(22, down ? SW - 1 - 16 : 16, r, COLORS.ring, r > 14);
    }
  }
  if (pose === "dizzy") {
    const y = down ? 39 : 3;
    for (let j = 0; j < 3; j++) {
      const a = at * 6 + j * 2.09;
      p.glyph(Math.round(21 + Math.cos(a) * 11), Math.round(y + Math.sin(a) * 2), GLYPHS.star);
    }
  }
}

export interface Particle {
  glyph: GlyphName;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

export interface Frame {
  size: number;
  sprite: Cell[];
  fx: Cell[];
}

/** Everything for one frame: Ping, his effects and floating particles. */
export function renderFrame(s: PingState, particles: Particle[], size = 64, ox = 10, oy = 12): Frame {
  const p = new Painter(size, ox, oy);
  drawPing(p, s);
  p.outline();
  p.toFx();
  drawFx(p, s);
  for (const q of particles) {
    // Blink out during the last quarter of a particle's life.
    if (q.life / q.max < 0.25 && Math.floor(q.life * 20) % 2) continue;
    p.glyph(Math.round(q.x), Math.round(q.y), GLYPHS[q.glyph]);
  }
  return { size, sprite: p.sprite, fx: p.fx };
}
