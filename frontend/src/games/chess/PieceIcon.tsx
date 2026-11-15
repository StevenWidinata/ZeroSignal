import type { ReactNode } from "react";
import type { Color, PieceType } from "./fen";
import { findPieces, type PieceArt } from "./items";

/**
 * Chess pieces drawn in code (no image files), in four looks:
 * simple vector shapes (classic, outline, neon, candy), pixel art, and
 * emoji "models" on a round base that shows the side.
 */

type Paint = { fill: string; stroke: string; detail: string; under?: string; glow?: string; shine?: boolean };

const GLYPH: Record<"classic" | "outline" | "neon" | "candy", Record<Color, Paint>> = {
  classic: {
    w: { fill: "#fafafa", stroke: "#1e1e1e", detail: "#1e1e1e" },
    b: { fill: "#2d2d2d", stroke: "#000000", detail: "#f0f0f0" },
  },
  outline: {
    w: { fill: "rgba(255,255,255,0.3)", stroke: "#ffffff", detail: "#ffffff", under: "#1a1a1a" },
    b: { fill: "rgba(0,0,0,0.3)", stroke: "#141414", detail: "#141414", under: "#f5f5f5" },
  },
  neon: {
    w: { fill: "#08131f", stroke: "#00e5ff", detail: "#00e5ff", glow: "#00e5ff" },
    b: { fill: "#1a0820", stroke: "#ff3df2", detail: "#ff3df2", glow: "#ff3df2" },
  },
  candy: {
    w: { fill: "#fff1f7", stroke: "#ff5fa2", detail: "#ff5fa2", shine: true },
    b: { fill: "#6c4ab6", stroke: "#2d1b69", detail: "#ffd6f0", shine: true },
  },
};

/** Vector shapes on a 45×45 grid: the body plus small details. */
function shape(type: PieceType, p: Paint, sw: number): ReactNode {
  const body = { fill: p.fill, stroke: p.stroke, strokeWidth: sw, strokeLinejoin: "round" as const };
  const line = { stroke: p.detail, strokeWidth: sw, strokeLinecap: "round" as const, fill: "none" };
  switch (type) {
    case "p":
      return (
        <>
          <path d="M16 36 L29 36 L26.5 23 Q22.5 20 18.5 23 Z" {...body} />
          <circle cx="22.5" cy="15" r="5.5" {...body} />
          <rect x="11" y="35" width="23" height="5" rx="2" {...body} />
        </>
      );
    case "r":
      return (
        <>
          <path d="M12 36 h21 v-4 h-3 l-1.5 -12 h3 v-7 h-4 v3 h-3 v-3 h-4 v3 h-3 v-3 h-4 v7 h3 l-1.5 12 h-3 z" {...body} />
          <rect x="10" y="35" width="25" height="5" rx="1.5" {...body} />
          <path d="M16.5 20 h12" {...line} />
        </>
      );
    case "n":
      return (
        <>
          <path d="M14 37 L31 37 C31 29 30 22 27 17 C25 12 20 9.5 16 10.5 L17 13.5 L11.5 19 C10.5 21 11.5 23.5 14 23.5 L18.5 21.5 C19 25 15 27 14 30 Z" {...body} />
          <circle cx="17.5" cy="15.5" r="1.3" fill={p.detail} />
          <rect x="11" y="35" width="23" height="5" rx="2" {...body} />
        </>
      );
    case "b":
      return (
        <>
          <path d="M22.5 11 C15 17 15.5 25 18 29 L27 29 C29.5 25 30 17 22.5 11 Z" {...body} />
          <circle cx="22.5" cy="8.5" r="2.6" {...body} />
          <rect x="16" y="28.5" width="13" height="3.5" rx="1" {...body} />
          <path d="M12 39 Q22.5 31 33 39 Z" {...body} />
          <path d="M25.5 16.5 L21 21.5" {...line} />
        </>
      );
    case "q":
      return (
        <>
          <path d="M11 34 L12.5 16 L17.5 27 L22.5 13 L27.5 27 L32.5 16 L34 34 Z" {...body} />
          <circle cx="12.5" cy="14.5" r="2.4" {...body} />
          <circle cx="22.5" cy="11" r="2.4" {...body} />
          <circle cx="32.5" cy="14.5" r="2.4" {...body} />
          <rect x="10" y="33.5" width="25" height="5.5" rx="1.5" {...body} />
          <path d="M13 30 h19" {...line} />
        </>
      );
    case "k":
      return (
        <>
          <path d="M12.5 34 C10 25 15 20 22.5 24 C30 20 35 25 32.5 34 Z" {...body} />
          <path d="M22.5 24 V15" {...line} />
          <path d="M22.5 5.5 V16 M18 10 H27" stroke={p.stroke} strokeWidth={sw * 2.6} strokeLinecap="round" />
          <path d="M22.5 5.5 V16 M18 10 H27" stroke={p.fill} strokeWidth={sw * 1.2} strokeLinecap="round" />
          <rect x="10" y="33.5" width="25" height="5.5" rx="1.5" {...body} />
          <path d="M14 30 h17" {...line} />
        </>
      );
  }
}

/** Pixel art, 10×10 ('#' = filled). Outlines are added automatically. */
const PIXELS: Record<PieceType, string[]> = {
  p: ["..........", "....##....", "...####...", "...####...", "....##....", "...####...", "...####...", "..######..", ".########.", ".########."],
  r: ["..........", "..........", ".##.##.##.", ".########.", "..######..", "..######..", "..######..", "..######..", ".########.", ".########."],
  n: ["..........", "....#.....", "...####...", "..######..", ".###.###..", ".##..###..", ".....###..", "....####..", "..######..", ".########."],
  b: ["..........", "....##....", "...####...", "..###.##..", "..##.###..", "..######..", "...####...", "....##....", "..######..", ".########."],
  q: ["..........", ".#..##..#.", ".#..##..#.", ".##.##.##.", ".########.", "..######..", "..######..", "...####...", "..######..", ".########."],
  k: ["....##....", "...####...", "....##....", "..######..", ".########.", ".########.", "..######..", "...####...", "..######..", ".########."],
};

const PIXEL_PAINT: Record<Color, { fill: string; edge: string }> = {
  w: { fill: "#f4f4f4", edge: "#1b1b1b" },
  b: { fill: "#262626", edge: "#e8e8e8" },
};

function pixelPiece(type: PieceType, color: Color): ReactNode {
  const cells: [number, number][] = [];
  PIXELS[type].forEach((row, y) => [...row].forEach((c, x) => c === "#" && cells.push([x, y])));
  const { fill, edge } = PIXEL_PAINT[color];
  return (
    <g transform="translate(2.5 2.5) scale(4)" shapeRendering="crispEdges">
      {cells.map(([x, y]) => (
        <rect key={`e${x}-${y}`} x={x - 0.3} y={y - 0.3} width={1.6} height={1.6} fill={edge} />
      ))}
      {cells.map(([x, y]) => (
        <rect key={`f${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />
      ))}
    </g>
  );
}

function emojiPiece(art: Extract<PieceArt, { kind: "emoji" }>, type: PieceType, color: Color): ReactNode {
  const white = color === "w";
  return (
    <>
      <circle cx="22.5" cy="23.5" r="19" fill={white ? "#fdfdfd" : "#2b2b2b"} stroke={white ? "#333" : "#e6e6e6"} strokeWidth="2.5" />
      <text x="22.5" y="25" textAnchor="middle" dominantBaseline="central" fontSize="23">
        {art[type]}
      </text>
    </>
  );
}

export default function PieceIcon({
  type,
  color,
  set,
  size = 40,
  className,
}: {
  type: PieceType;
  color: Color;
  set: string;
  size?: number | string;
  className?: string;
}) {
  const art = findPieces(set).art;
  let content: ReactNode;
  let style: React.CSSProperties | undefined;
  if (art.kind === "pixel") content = pixelPiece(type, color);
  else if (art.kind === "emoji") content = emojiPiece(art, type, color);
  else {
    const p = GLYPH[art.style][color];
    content = (
      <>
        {p.under && <g opacity="0.9">{shape(type, { ...p, fill: "none", stroke: p.under, detail: p.under }, 4.5)}</g>}
        {shape(type, p, art.style === "outline" ? 2.2 : 1.6)}
        {p.shine && <ellipse cx="18" cy="26" rx="2" ry="4" fill="#fff" opacity="0.55" transform="rotate(20 18 26)" />}
      </>
    );
    if (p.glow) style = { filter: `drop-shadow(0 0 2px ${p.glow}) drop-shadow(0 0 4px ${p.glow})` };
  }
  return (
    <svg viewBox="0 0 45 45" width={size} height={size} className={className} style={style} aria-hidden="true">
      {content}
    </svg>
  );
}
