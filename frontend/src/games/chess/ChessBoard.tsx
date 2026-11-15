import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { isTyping } from "../../platform/display";
import { currentAction } from "../../platform/keymap";
import { playSfx } from "../../platform/sound";
import {
  FILES,
  PIECE_NAME,
  isLight,
  kingIndex,
  movesBetween,
  movesFrom,
  parseFen,
  sideToMove,
  squareIndex,
  squareName,
  type Color,
  type PieceType,
} from "./fen";
import { findBoard } from "./items";
import PieceIcon from "./PieceIcon";

interface Props {
  fen: string;
  /** Which side is at the bottom. */
  orientation: Color;
  /** Moves you may make now (UCI). Empty = look only. */
  legal: string[];
  lastMove?: string | null;
  check?: boolean;
  boardStyle: string;
  pieceSet: string;
  onMove: (uci: string) => void;
  /** Square to flash red (a wrong puzzle move). */
  flash?: string | null;
  /** Extra squares to mark (a hint). */
  hint?: string[];
}

interface Drag {
  from: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const PROMOS: PieceType[] = ["q", "r", "b", "n"];

export default function ChessBoard({ fen, orientation, legal, lastMove, check, boardStyle, pieceSet, onMove, flash, hint }: Props) {
  const art = findBoard(boardStyle).art;
  const board = useMemo(() => parseFen(fen), [fen]);
  const from = useMemo(() => movesFrom(legal), [legal]);
  const mover = sideToMove(fen);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState(() => (orientation === "w" ? 52 : 11)); // e2 / e7
  const suppressClick = useRef(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  // A new position clears any half-made move.
  useEffect(() => {
    setSelected(null);
    setPromo(null);
    setDrag(null);
  }, [fen, legal]);

  const targets = new Set((selected ? from.get(selected) ?? [] : []).map((u) => u.slice(2, 4)));
  const checkIdx = check ? kingIndex(board, mover) : -1;
  const last = lastMove ? [lastMove.slice(0, 2), lastMove.slice(2, 4)] : [];

  function tryMove(a: string, b: string): boolean {
    const opts = movesBetween(legal, a, b);
    if (!opts.length) return false;
    if (opts.some((u) => u.length === 5)) setPromo({ from: a, to: b });
    else onMove(opts[0]);
    setSelected(null);
    return true;
  }

  function clickSquare(sq: string) {
    if (promo) return;
    if (selected && targets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (from.has(sq)) {
      playSfx("click");
      setSelected(sq === selected ? null : sq);
      return;
    }
    setSelected(null);
  }

  // Display order: White at the bottom shows a8 first; Black flips it.
  const order = orientation === "w" ? [...Array(64).keys()] : [...Array(64).keys()].reverse();

  function onPointerDown(e: PointerEvent, sq: string) {
    if (promo || !from.has(sq) || e.button !== 0) return;
    setDrag({ from: sq, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false });
  }

  // The latest drag and move function, for the window listeners below.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const tryMoveRef = useRef(tryMove);
  tryMoveRef.current = tryMove;

  useEffect(() => {
    if (!drag) return;
    const move = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: e.clientX, y: e.clientY, moved: d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6 };
      dragRef.current = next;
      setDrag(next);
    };
    const up = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d?.moved) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-sq]");
      const to = el?.dataset.sq;
      if (to && to !== d.from) {
        if (!tryMoveRef.current(d.from, to)) setSelected(d.from);
      } else {
        setSelected(d.from);
      }
      // The click that follows a drag isn't a tap.
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  // Keys come from Settings → Controls (platform/keymap.ts, "chess").
  function onKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const flip = orientation === "w" ? 1 : -1;
    const a = currentAction("chess", e.code);
    const step: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
    const s = a ? step[a] : undefined;
    if (a === "select") {
      e.preventDefault();
      buttons.current[cursor]?.click();
    } else if (s) {
      e.preventDefault();
      const r = Math.min(7, Math.max(0, Math.floor(cursor / 8) + s[0] * flip));
      const c = Math.min(7, Math.max(0, (cursor % 8) + s[1] * flip));
      const next = r * 8 + c;
      setCursor(next);
      buttons.current[next]?.focus();
    } else if (a === "cancel") {
      setSelected(null);
      setPromo(null);
    }
  }

  const style = { "--sq-light": art.light, "--sq-dark": art.dark, "--board-border": art.border } as CSSProperties;
  const dragging = drag?.moved ? board[squareIndex(drag.from)] : null;

  return (
    <div className={`chess-board board-${art.style}`} style={style}>
      <div className="chess-grid" role="grid" aria-label="Chess board" onKeyDown={onKeyDown}>
        {order.map((i, d) => {
          const sq = squareName(i);
          const p = board[i];
          const row = Math.floor(d / 8);
          const col = d % 8;
          const cls = [
            "chess-sq",
            isLight(i) ? "light" : "dark",
            last.includes(sq) ? "last" : "",
            selected === sq ? "sel" : "",
            targets.has(sq) ? (p ? "target capture" : "target") : "",
            i === checkIdx ? "check" : "",
            flash === sq ? "flash" : "",
            hint?.includes(sq) ? "hint" : "",
            drag?.moved && drag.from === sq ? "lifted" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const label = `${sq}${p ? `, ${p.color === "w" ? "white" : "black"} ${PIECE_NAME[p.type]}` : ""}${targets.has(sq) ? ", can move here" : ""}`;
          return (
            <button
              key={sq}
              ref={(el) => (buttons.current[i] = el)}
              type="button"
              role="gridcell"
              data-sq={sq}
              className={cls}
              tabIndex={i === cursor ? 0 : -1}
              aria-label={label}
              aria-pressed={selected === sq}
              onFocus={() => setCursor(i)}
              onPointerDown={(e) => onPointerDown(e, sq)}
              onClick={() => {
                if (suppressClick.current) return;
                clickSquare(sq);
              }}
              style={p && from.has(sq) ? { touchAction: "none", cursor: "grab" } : undefined}
            >
              {col === 0 && <span className="chess-coord coord-rank">{sq[1]}</span>}
              {row === 7 && <span className="chess-coord coord-file">{sq[0]}</span>}
              {p && (
                <PieceIcon
                  type={p.type}
                  color={p.color}
                  set={pieceSet}
                  size="88%"
                  className={`chess-piece${last[1] === sq ? " pop" : ""}`}
                />
              )}
            </button>
          );
        })}
      </div>

      {dragging && drag && (
        <div className="chess-drag" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <PieceIcon type={dragging.type} color={dragging.color} set={pieceSet} size="100%" />
        </div>
      )}

      {promo && (
        <div className="chess-promo" role="dialog" aria-label="Promote your pawn to">
          <strong>Promote to</strong>
          <div>
            {PROMOS.map((t) => (
              <button
                key={t}
                type="button"
                aria-label={PIECE_NAME[t]}
                title={PIECE_NAME[t]}
                onClick={() => {
                  const u = `${promo.from}${promo.to}${t}`;
                  setPromo(null);
                  if (legal.includes(u)) onMove(u);
                }}
              >
                <PieceIcon type={t} color={mover} set={pieceSet} size={48} />
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setPromo(null)}>
            Cancel
          </button>
        </div>
      )}
      <span className="sr-only">Files {FILES.split("").join(" ")}. Use the arrow keys to move around, Enter to pick a piece and its square.</span>
    </div>
  );
}
