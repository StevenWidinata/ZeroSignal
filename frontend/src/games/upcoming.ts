import type { GameModule, PlayStyle } from "../platform/types";

/**
 * Planned games, shown as "Coming soon" (ids match backend/src/games.rs).
 * Every one follows docs/GAME_KIT.md: setup screen with modes, a Daily,
 * server-checked scores, per-mode and weekly leaderboards, 3 quests,
 * 4 achievements, free + paid cosmetics and the shared results screen.
 */
const soon = (
  id: string,
  title: string,
  icon: string,
  accent: "yellow" | "green" | "blue",
  tagline: string,
  tags: string[],
  play: PlayStyle[],
): GameModule => ({ meta: { id, title, icon, accent, tagline, tags, play, status: "soon", scoreLabel: "Best score" } });

export const UPCOMING: GameModule[] = [
  soon("brick-breaker", "Brick Breaker", "🧱", "blue", "Bounce the ball, smash every brick, catch the drops.", ["Arcade", "Levels"], ["solo"]),
  soon("signal-flap", "Signal Flap", "🪽", "yellow", "One button. Fly through the gaps as far as you can.", ["Reflex", "One button"], ["solo", "daily"]),
  soon("memory-match", "Memory Match", "🃏", "green", "Flip cards and find every pair before time runs out.", ["Memory", "Timed"], ["solo"]),
  soon("pixel-picross", "Pixel Picross", "🖼️", "blue", "Solve the number clues to paint a hidden pixel picture.", ["Logic", "Pictures"], ["solo", "daily"]),
  soon("block-drop", "Block Drop", "🟪", "yellow", "Stack falling blocks and clear lines. The server replays it.", ["Puzzle", "Replay"], ["solo"]),
  soon("sudoku", "Sudoku", "🔢", "green", "The classic number puzzle, with a fresh Daily.", ["Logic", "Classic"], ["solo", "daily"]),
  soon("pong-online", "Pong Online", "🏓", "blue", "Paddles, a ball and a friend on another device.", ["Arcade", "Real-time"], ["online", "local"]),
];
