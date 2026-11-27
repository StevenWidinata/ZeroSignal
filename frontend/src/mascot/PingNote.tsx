import type { ReactNode } from "react";
import PingCanvas, { OFFSET_X, OFFSET_Y } from "./PingCanvas";
import { SW, type Pose } from "./sprite";
import "./ping.css";

interface Props {
  /** What he's doing (loops). Null = just hanging out, blinking. */
  pose?: Pose | null;
  /** Screen pixels per sprite pixel. */
  scale?: number;
  children: ReactNode;
  className?: string;
}

/** A small Ping next to a message: empty lists, errors, "not found". He's decoration; the text says it all. */
export default function PingNote({ pose = null, scale = 1, children, className = "" }: Props) {
  const box = SW * scale;
  return (
    <span className={`ping-note ${className}`}>
      <PingFigure pose={pose} scale={scale} box={box} />
      <span className="ping-note-text">{children}</span>
    </span>
  );
}

/** Just Ping in a pose, sized to his sprite (effects may spill past the box). */
export function PingFigure({ pose = null, scale, box = SW * scale }: { pose?: Pose | null; scale: number; box?: number }) {
  return (
    <span className="ping-figure" style={{ width: box, height: box }} aria-hidden="true">
      <PingCanvas pose={pose} scale={scale} className="ping-canvas" style={{ left: -OFFSET_X * scale, top: -OFFSET_Y * scale }} />
    </span>
  );
}
