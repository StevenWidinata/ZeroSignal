/**
 * Tiny canvas particle bursts (sparks when you eat, crash, grab a power-up…).
 *
 * Pure logic with no store/window imports, so it can be unit-tested; the
 * caller decides whether effects are on (light graphics / reduced motion).
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life in ms. */
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface BurstOptions {
  count?: number;
  /** Pixels per second. */
  speed?: number;
  /** Lifetime in ms. */
  life?: number;
  size?: number;
  /** Downward pull in px/s². */
  gravity?: number;
}

/** Hard cap so a busy screen never slows the game down. */
export const MAX_PARTICLES = 240;

export class Bursts {
  particles: Particle[] = [];
  private gravity = 0;

  /** Throw `count` sparks out of (x, y) in every direction. */
  spawn(x: number, y: number, color: string, opts: BurstOptions = {}): void {
    const { count = 12, speed = 120, life = 500, size = 3, gravity = 0 } = opts;
    this.gravity = gravity;
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.6;
      const v = speed * (0.5 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size });
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  /** Move everything forward by `ms`; drops dead particles. */
  step(ms: number): void {
    const dt = ms / 1000;
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += this.gravity * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= ms;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + (0.6 * p.life) / p.max);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.particles = [];
  }
}
