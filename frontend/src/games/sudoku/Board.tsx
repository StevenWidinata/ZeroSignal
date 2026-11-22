import { box, col, noteDigits, row, squareName, type Notes } from "./logic";
import { themeVars } from "./items";

interface Props {
  givens: number[];
  grid: number[];
  notes: Notes;
  hinted: Set<number>;
  /** Wrong squares from the last Check. */
  wrong: Set<number>;
  /** Numbers that repeat in a row, column or box. */
  clash: Set<number>;
  cursor: number;
  /** The square a hint just filled. */
  flash: number | null;
  /** After the game: the solution, shown in squares you left empty. */
  solution: number[] | null;
  theme: string;
  onPick: (cell: number) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/** The 9×9 grid: givens, your numbers, notes and highlights. */
export default function Board({ givens, grid, notes, hinted, wrong, clash, cursor, flash, solution, theme, onPick, onKeyDown }: Props) {
  const picked = grid[cursor];
  return (
    <div className="sd-board" style={themeVars(theme) as React.CSSProperties} role="grid" aria-label="Sudoku board" onKeyDown={onKeyDown}>
      {grid.map((v, c) => {
        const given = givens[c] !== 0;
        const revealed = !v && solution ? solution[c] : 0;
        const shown = v || revealed;
        let cls = "sd-cell";
        if (col(c) % 3 === 2 && col(c) < 8) cls += " br";
        if (row(c) % 3 === 2 && row(c) < 8) cls += " bb";
        if (given) cls += " given";
        else if (hinted.has(c)) cls += " hinted";
        else if (revealed) cls += " revealed";
        else if (v) cls += " entry";
        if (c === cursor) cls += " selected";
        else if (picked && v === picked) cls += " same-num";
        else if (row(c) === row(cursor) || col(c) === col(cursor) || box(c) === box(cursor)) cls += " peer";
        if (wrong.has(c)) cls += " wrong";
        else if (clash.has(c)) cls += " clash";
        if (flash === c) cls += " flash";
        const label = `${squareName(c)}: ${shown ? shown : "empty"}${given ? ", printed" : hinted.has(c) ? ", from a hint" : ""}${wrong.has(c) ? ", wrong" : clash.has(c) ? ", repeats in its row, column or box" : ""}${!shown && notes[c] ? `, notes ${noteDigits(notes[c]).join(" ")}` : ""}`;
        return (
          <button
            key={c}
            type="button"
            role="gridcell"
            data-cell={c}
            className={cls}
            tabIndex={c === cursor ? 0 : -1}
            aria-label={label}
            aria-selected={c === cursor}
            onClick={() => onPick(c)}
          >
            {shown ? (
              <span className="sd-num">{shown}</span>
            ) : notes[c] ? (
              <span className="sd-notes" aria-hidden="true">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <span key={d} className={picked === d ? "hl" : ""}>
                    {notes[c] & (1 << d) ? d : ""}
                  </span>
                ))}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
