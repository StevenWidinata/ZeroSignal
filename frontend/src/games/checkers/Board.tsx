import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { isTyping } from "../../platform/display";
import { currentAction } from "../../platform/keymap";
import { playSfx } from "../../platform/sound";
import type { CheckersSide } from "../../api/types";
import { findBoard } from "./items";
import Piece from "./Piece";
import { click, movable, nextSteps, toPaths } from "./picking";
import { parsePath, rc, sqAt } from "./rules";

interface Props {
  /** 32 cells: 0 empty, ±1 man, ±2 king (+ = dark). */
  cells: number[];
  /** The side shown at the bottom. */
  bottom: CheckersSide;
  /** Legal moves for whoever may move now (empty = look only). */
  legal: string[];
  /** Last move in notation, highlighted. */
  lastMove?: string | null;
  boardStyle: string;
  pieceSet: string;
  onMove: (notation: string) => void;
}

const sqName = (sq: number) => String(sq + 1);

export default function Board({ cells, bottom, legal, lastMove, boardStyle, pieceSet, onMove }: Props) {
  const paths = useMemo(() => toPaths(legal), [legal]);
  const [picked, setPicked] = useState<number[]>([]);
  const [cursor, setCursor] = useState<number>(() => (bottom === "dark" ? 9 : 22));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const art = findBoard(boardStyle).art;

  // New position: drop a half-picked move.
  useEffect(() => setPicked([]), [legal]);

  const can = movable(paths);
  const steps = picked.length > 0 ? nextSteps(paths, picked) : new Set<number>();
  const last = new Set(lastMove ? (parsePath(lastMove) ?? []) : []);
  const forced = paths.length > 0 && legal[0]?.includes("x");

  function pick(sq: number) {
    const r = click(paths, picked, sq);
    if (r.kind === "done") {
      setPicked([]);
      onMove(r.notation);
    } else if (r.kind === "picking") {
      playSfx("click");
      setPicked(r.picked);
    } else {
      setPicked([]);
    }
  }

  // Screen row/col of a board row/col (dark starts at the top, so a dark
  // player sees the board turned around).
  const flip = bottom === "dark";
  const toScreen = (r: number, c: number): [number, number] => (flip ? [7 - r, 7 - c] : [r, c]);

  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const a = currentAction("checkers", e.code);
    const step: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    if (a === "select") {
      e.preventDefault();
      pick(cursor);
      return;
    }
    if (a === "cancel") {
      setPicked([]);
      return;
    }
    const s = a ? step[a] : undefined;
    if (!s) return;
    e.preventDefault();
    // Dark squares sit diagonally: up/down goes to the next row (right
    // first, then left); left/right jumps two columns along the row.
    const [r, c] = toScreen(...rc(cursor));
    const tries: [number, number][] =
      s[0] !== 0
        ? [
            [r + s[0], c + 1],
            [r + s[0], c - 1],
          ]
        : [[r, c + 2 * s[1]]];
    for (const [sr, sc] of tries) {
      if (sr < 0 || sr > 7 || sc < 0 || sc > 7) continue;
      const next = sqAt(...toScreen(sr, sc));
      if (next !== null) {
        setCursor(next);
        buttons.current[next]?.focus();
        return;
      }
    }
  }

  const style = { "--ck-light": art.light, "--ck-dark": art.dark, "--ck-border": art.border } as CSSProperties;
  const rows = Array.from({ length: 8 }, (_, sr) => sr);

  return (
    <div className={`ck-board board-${art.style}`} style={style}>
      <div className="ck-grid" role="grid" aria-label="Checkers board" onKeyDown={onKeyDown}>
        {rows.map((sr) => (
          <div key={sr} className="ck-row" role="row">
            {rows.map((sc) => {
              const [br, bc] = toScreen(sr, sc);
              const sq = sqAt(br, bc);
              if (sq === null) return <span key={sc} className="ck-sq light" role="gridcell" aria-hidden="true" />;
              const v = cells[sq];
              const selected = picked.includes(sq);
              const target = steps.has(sq);
              const moveFrom = picked.length === 0 && can.has(sq);
              const piece = v === 0 ? "empty" : `${v > 0 ? "dark" : "light"} ${Math.abs(v) === 2 ? "king" : "man"}`;
              const cls = [
                "ck-sq dark",
                selected && "selected",
                target && "target",
                moveFrom && "can-move",
                last.has(sq) && "last",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={sc}
                  ref={(el) => {
                    buttons.current[sq] = el;
                  }}
                  type="button"
                  role="gridcell"
                  className={cls}
                  tabIndex={sq === cursor ? 0 : -1}
                  aria-label={`Square ${sqName(sq)}, ${piece}${target ? ", move here" : ""}${moveFrom ? ", can move" : ""}`}
                  aria-pressed={selected}
                  onFocus={() => setCursor(sq)}
                  onClick={() => pick(sq)}
                >
                  <span className="ck-num" aria-hidden="true">
                    {sqName(sq)}
                  </span>
                  {v !== 0 && <Piece value={v} set={pieceSet} />}
                  {target && <span className="ck-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {forced && <p className="ck-forced">⚠ A capture is possible, so you must jump.</p>}
    </div>
  );
}
