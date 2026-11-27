import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { PingBrain } from "./engine";
import { renderFrame, type Pose } from "./sprite";

/** The canvas grid Ping is drawn on (his 44×44 sprite plus room for effects). */
export const GRID = 64;
export const OFFSET_X = 10;
export const OFFSET_Y = 12;

interface Props {
  /** Drive an existing brain (the live mascot), or omit and give a `pose`. */
  brain?: PingBrain;
  /** A pose that loops on its own (tutorials, empty states). Null = plain idle with blinks. */
  pose?: Pose | null;
  /** Screen pixels per sprite pixel. */
  scale: number;
  /** Reduced motion: idles don't start on their own. */
  still?: boolean;
  night?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Draws Ping on a pixelated canvas and keeps him animated. Decorative: wrap it in a labelled control when interactive. */
export default function PingCanvas({ brain, pose = null, scale, still = false, night = false, className, style }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const own = useMemo(() => brain ?? new PingBrain({ fixed: pose }), [brain, pose]);
  // Paint at a whole number of pixels per cell (no seams); CSS shrinks it when `scale` isn't whole.
  const paint = Math.max(1, Math.ceil(scale));
  const px = GRID * paint;
  const size = GRID * scale;

  useEffect(() => {
    own.night = night;
  }, [own, night]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      own.update(dt, still);
      const f = renderFrame(own.state(), own.particles, GRID, OFFSET_X, OFFSET_Y);
      ctx.clearRect(0, 0, px, px);
      for (const layer of [f.sprite, f.fx])
        for (let i = 0; i < layer.length; i++) {
          const c = layer[i];
          if (!c) continue;
          ctx.fillStyle = c;
          ctx.fillRect((i % GRID) * paint, Math.floor(i / GRID) * paint, paint, paint);
        }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [own, paint, px, still]);

  return <canvas ref={ref} width={px} height={px} className={className} style={{ ...style, width: size, height: size }} aria-hidden="true" />;
}
