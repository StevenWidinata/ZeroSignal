import { describe, expect, it } from "vitest";
import { boardCells } from "./boardScore";

describe("leaderboard cells", () => {
  it("shows a plain score and its detail", () => {
    expect(boardCells({ level: 1, label: "Endless" }, 12_345, "7")).toEqual({ main: "12,345", extra: "7" });
    expect(boardCells(undefined, 50, null)).toEqual({ main: "50", extra: "–" });
  });

  it("splits a packed Campaign score into stars and total score", () => {
    const board = { level: 2, label: "Campaign", scoreLabel: "Stars", detailLabel: "Total score", packed: 10_000_000 };
    expect(boardCells(board, 42 * 10_000_000 + 61_230, "42")).toEqual({ main: "42", extra: "61,230" });
    expect(boardCells(board, 3 * 10_000_000 + 1_800, "3", true)).toEqual({ main: "1,800", extra: "3 stars" });
  });
});
