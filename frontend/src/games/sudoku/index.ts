import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const sudoku: GameModule = {
  meta: {
    id: "sudoku",
    title: "Sudoku",
    tagline: "The classic number puzzle, with a fresh Daily.",
    tags: ["Logic", "Classic"],
    play: ["solo", "daily"],
    accent: "green",
    icon: "🔢",
    status: "live",
    scoreLabel: "Best score",
    boards: [
      { level: 1, label: "🌱 Easy" },
      { level: 2, label: "🌿 Medium" },
      { level: 3, label: "🌲 Hard" },
      { level: 4, label: "🔥 Expert" },
      { level: 5, label: "📅 Today's Daily", period: "today" },
    ],
    tutorial: [
      {
        icon: "🔢",
        title: "Fill the grid",
        text: "Put 1 to 9 in every row, column and 3×3 box, each number once. Tap a square, then a number (or type it).",
      },
      {
        icon: "✏️",
        title: "Notes",
        text: "Turn Notes on to write small pencil numbers. Placing a number clears it from the notes in its row, column and box.",
      },
      {
        icon: "✔",
        title: "Check when it's full",
        text: "Nothing is checked while you play. When every square has a number, press Check: wrong squares turn red and the clock keeps running.",
      },
      {
        icon: "💡",
        title: "Hints and the Daily",
        text: "Stuck? A hint fills one square and says why (+30 s, 3 per puzzle). The Daily is the same puzzle for everyone, one try a day.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default sudoku;
