import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { isTyping } from "../../platform/display";
import { currentAction } from "../../platform/keymap";
import { useSettings } from "../../store/settings";
import type { DrawnShip, Fx } from "./fleet";
import { label } from "./fleet";
import { findSea } from "./items";
import { pingArea, SIZE } from "./rules";
import ShipArt from "./ShipArt";

const MARK_TEXT: Record<string, string> = {
  o: "miss",
  x: "hit",
  s: "sunk",
  "-": "empty water",
  "*": "ship spotted",
  m: "mine",
  "+": "supply crate",
  c: "opened crate",
};
const MARK_ICON: Record<string, string> = { o: "•", x: "✕", s: "✕", "*": "◎", m: "💣", "+": "📦", c: "📭" };
const MARK_CLASS: Record<string, string> = { o: "miss", x: "hit", s: "sunk", "-": "empty", "*": "spotted", m: "mine", "+": "crate", c: "crate opened" };

export interface GridProps {
  label: string;
  sea: string;
  fleetSkin: string;
  /** What's known about each square (see SonarSea.marks). */
  marks?: string;
  /** Ships to draw on top of the water. */
  ships?: DrawnShip[];
  /** Ships in `ships` that are sunk (drawn dark). */
  sunk?: number[];
  /** A fleet shown faintly (the hidden fleet, revealed at the end). */
  ghosts?: DrawnShip[];
  pings?: { center: number; count: number }[];
  /** Squares you can pick now. */
  interactive?: boolean;
  pingMode?: boolean;
  onPick?: (cell: number) => void;
  onTogglePing?: () => void;
  onRotate?: () => void;
  /** Placing ships: the ship under the pointer, red when it doesn't fit. Aiming a power: what it would touch. */
  preview?: { cells: number[]; ok: boolean } | null;
  previewKind?: "place" | "aim";
  /** Aiming a power: every square can be picked, not just unknown ones. */
  pickAll?: boolean;
  /** Tactics, your own sea: where your mines are hidden. */
  mines?: number[];
  /** Tactics: radar sweeps (a band over the row or column with its count). */
  sweeps?: { line: number; row: boolean; count: number }[];
  /** Effects of the last move (a new `key` plays them again). */
  fx?: { key: number; list: Fx[] } | null;
  onHover?: (cell: number | null) => void;
  onCellPointerDown?: (cell: number, e: PointerEvent) => void;
  last?: number | null;
  small?: boolean;
}

const area = (cells: number[]) => {
  const rows = cells.map((c) => Math.floor(c / SIZE));
  const cols = cells.map((c) => c % SIZE);
  const r0 = Math.min(...rows);
  const c0 = Math.min(...cols);
  return { gridRow: `${r0 + 2} / ${Math.max(...rows) + 3}`, gridColumn: `${c0 + 2} / ${Math.max(...cols) + 3}` };
};

export default function Grid(p: GridProps) {
  const sea = findSea(p.sea).art;
  const light = useSettings((s) => s.lightGraphics);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState(44);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const marks = p.marks ?? ".".repeat(SIZE * SIZE);

  const pingPreview = p.pingMode && p.interactive && hover !== null ? pingArea(hover) : null;
  const okClass = p.previewKind === "aim" ? "aim-ok" : "place-ok";
  const badClass = p.previewKind === "aim" ? "aim-bad" : "place-bad";
  const mineSet = new Set(p.mines ?? []);
  const previewSet = new Set(p.preview?.cells ?? []);

  function setHoverCell(c: number | null) {
    setHover(c);
    p.onHover?.(c);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const a = currentAction("sonar", e.code);
    const step: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    if (a && step[a]) {
      e.preventDefault();
      const r = Math.min(9, Math.max(0, Math.floor(cursor / SIZE) + step[a][0]));
      const c = Math.min(9, Math.max(0, (cursor % SIZE) + step[a][1]));
      const next = r * SIZE + c;
      setCursor(next);
      setHoverCell(next);
      buttons.current[next]?.focus();
    } else if (a === "fire" && p.interactive) {
      e.preventDefault();
      p.onPick?.(cursor);
    } else if (a === "ping" && p.onTogglePing) {
      e.preventDefault();
      p.onTogglePing();
    } else if (a === "rotate" && p.onRotate) {
      e.preventDefault();
      p.onRotate();
    }
  }

  const style = { "--water": sea.water, "--deep": sea.deep, "--wline": sea.line } as CSSProperties;

  return (
    <div className={`sonar-grid sea-${sea.style}${p.small ? " small" : ""}${p.pingMode && p.interactive && !light ? " ping-mode" : ""}`} style={style}>
      <div className="sonar-cells" role="grid" aria-label={p.label} onKeyDown={onKeyDown} onPointerLeave={() => setHoverCell(null)}>
        {Array.from({ length: SIZE }, (_, i) => (
          <span key={`c${i}`} className="sonar-head" style={{ gridRow: 1, gridColumn: i + 2 }} aria-hidden="true">
            {String.fromCharCode(65 + i)}
          </span>
        ))}
        {Array.from({ length: SIZE }, (_, i) => (
          <span key={`r${i}`} className="sonar-head" style={{ gridRow: i + 2, gridColumn: 1 }} aria-hidden="true">
            {i + 1}
          </span>
        ))}
        {(p.ghosts ?? []).map((s) => (
          <div key={`g${s.ship}`} className="sonar-ship ghost" style={area(s.cells)}>
            <ShipArt len={s.cells.length} horizontal={s.cells.length < 2 || s.cells[1] - s.cells[0] === 1} skin={p.fleetSkin} />
          </div>
        ))}
        {(p.ships ?? []).map((s) => (
          <div key={`s${s.ship}`} className="sonar-ship" style={area(s.cells)}>
            <ShipArt
              len={s.cells.length}
              horizontal={s.cells.length < 2 || s.cells[1] - s.cells[0] === 1}
              skin={p.fleetSkin}
              sunk={p.sunk?.includes(s.ship)}
            />
          </div>
        ))}
        {Array.from({ length: SIZE * SIZE }, (_, cell) => {
          const m = marks[cell];
          const canPick = !!p.interactive && (p.pingMode || p.pickAll || m === "." || m === "*" || m === "+");
          const ownMine = m === "." && mineSet.has(cell);
          const cls = [
            "sonar-cell",
            MARK_CLASS[m] ?? "",
            ownMine ? "own-mine" : "",
            p.last === cell ? "last" : "",
            pingPreview?.includes(cell) ? "ping-preview" : "",
            previewSet.has(cell) ? (p.preview?.ok ? okClass : badClass) : "",
            canPick ? "pickable" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={cell}
              ref={(el) => (buttons.current[cell] = el)}
              type="button"
              role="gridcell"
              data-cell={cell}
              className={cls}
              style={{ gridRow: Math.floor(cell / SIZE) + 2, gridColumn: (cell % SIZE) + 2 }}
              tabIndex={cell === cursor ? 0 : -1}
              aria-label={`${label(cell)}${MARK_TEXT[m] ? `, ${MARK_TEXT[m]}` : ownMine ? ", your mine" : ""}`}
              aria-disabled={!canPick}
              onFocus={() => setCursor(cell)}
              onPointerEnter={() => setHoverCell(cell)}
              onPointerDown={(e) => p.onCellPointerDown?.(cell, e)}
              onClick={() => canPick && p.onPick?.(cell)}
            >
              {MARK_ICON[m] ? <span className="mk">{MARK_ICON[m]}</span> : ownMine && <span className="mk">💣</span>}
            </button>
          );
        })}
        {(p.sweeps ?? []).map((w, i) => (
          <div
            key={`w${i}`}
            className={`sonar-sweep${w.row ? " row" : " col"}${w.count === 0 ? " zero" : ""}`}
            style={w.row ? { gridRow: w.line + 2, gridColumn: "2 / 12" } : { gridRow: "2 / 12", gridColumn: w.line + 2 }}
            aria-hidden="true"
          >
            <span>{w.count}</span>
          </div>
        ))}
        {!light &&
          p.fx?.list.map((f, i) =>
            f.cells.length ? (
              <div
                key={`fx${p.fx!.key}-${i}`}
                className={`sonar-fx fx-${f.kind}${f.cells.length > 1 && Math.abs(f.cells[1] - f.cells[0]) === SIZE ? " v" : ""}${f.cells.length > 1 && f.cells[1] < f.cells[0] ? " rev" : ""}`}
                style={area(f.cells)}
                aria-hidden="true"
              />
            ) : null,
          )}
        {(p.pings ?? []).map((g, i) => (
          <div key={`p${i}`} className={`sonar-ping${g.count === 0 ? " zero" : ""}`} style={area(pingArea(g.center))} aria-hidden="true">
            <span>{g.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
