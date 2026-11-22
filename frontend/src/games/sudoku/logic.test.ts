import { describe, expect, it } from "vitest";
import {
  PEERS,
  box,
  clashes,
  counts,
  emptyNotes,
  formatTime,
  gridCode,
  hasNote,
  isFull,
  moveCursor,
  noteDigits,
  parseGrid,
  placeClearsNotes,
  readNotes,
  sameUnit,
  squareName,
  toggleNote,
} from "./logic";

const P = "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";

describe("sudoku grid", () => {
  it("reads and writes grids", () => {
    const g = parseGrid(P);
    expect(g).toHaveLength(81);
    expect(g.slice(0, 5)).toEqual([5, 3, 0, 0, 7]);
    expect(gridCode(g)).toBe(P);
    expect(isFull(g)).toBe(false);
    expect(isFull(Array(81).fill(1))).toBe(true);
  });

  it("knows peers", () => {
    expect(PEERS.every((p) => p.length === 20)).toBe(true);
    expect(box(40)).toBe(4);
    expect(sameUnit(0, 8) && sameUnit(0, 72) && sameUnit(0, 20)).toBe(true);
    expect(sameUnit(0, 30)).toBe(false);
    expect(squareName(30)).toBe("row 4, column 4");
  });

  it("finds clashes and counts numbers", () => {
    const g = parseGrid(P);
    expect(clashes(g).size).toBe(0);
    g[2] = 5; // a second 5 in row 1
    expect([...clashes(g)].sort((a, b) => a - b)).toEqual([0, 2]);
    expect(counts(parseGrid(P))[5]).toBe(3);
    expect(counts(parseGrid(P))[0]).toBe(0);
  });
});

describe("sudoku notes", () => {
  it("toggles and clears notes", () => {
    let n = toggleNote(emptyNotes(), 10, 4);
    n = toggleNote(n, 10, 7);
    n = toggleNote(n, 11, 4);
    n = toggleNote(n, 50, 4);
    expect(noteDigits(n[10])).toEqual([4, 7]);
    expect(hasNote(toggleNote(n, 10, 4), 10, 4)).toBe(false);
    // Placing 4 in square 12 (row 2): its row-mates lose note 4, square 50 keeps it.
    const after = placeClearsNotes(n, 12, 4);
    expect(noteDigits(after[10])).toEqual([7]);
    expect(after[11]).toBe(0);
    expect(hasNote(after, 50, 4)).toBe(true);
    expect(after[12]).toBe(0);
  });

  it("reads saved notes defensively", () => {
    const n = toggleNote(emptyNotes(), 3, 9);
    expect(readNotes(JSON.stringify(n))).toEqual(n);
    expect(readNotes(null)).toEqual(emptyNotes());
    expect(readNotes("oops")).toEqual(emptyNotes());
    expect(readNotes("[1,2]")).toEqual(emptyNotes());
    expect(readNotes(JSON.stringify(Array(81).fill(5000)))).toEqual(emptyNotes());
  });
});

describe("sudoku moves and time", () => {
  it("moves the cursor with wrap-around", () => {
    expect(moveCursor(0, "up")).toBe(72);
    expect(moveCursor(0, "left")).toBe(8);
    expect(moveCursor(8, "right")).toBe(0);
    expect(moveCursor(40, "down")).toBe(49);
  });

  it("formats time", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(754_000)).toBe("12:34");
    expect(formatTime(3_723_000)).toBe("1:02:03");
  });
});
