import type { GameModule } from "../platform/types";

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
): GameModule => ({ meta: { id, title, icon, accent, tagline, tags, status: "soon", scoreLabel: "Best score" } });

export const UPCOMING: GameModule[] = [
  soon("chess", "Chess", "♟️", "blue", "Checkmate Zero-Bot, solve the daily puzzle, or play a friend online.", ["Strategy", "AI", "Online"]),
  soon("snake-signal", "Snake Signal", "🐍", "green", "Grow the snake, grab power-ups, don't bite your tail.", ["Arcade", "Solo", "Daily"]),
  soon("brick-breaker", "Brick Breaker", "🧱", "blue", "Bounce the ball, smash every brick, catch the drops.", ["Arcade", "Solo", "Levels"]),
  soon("signal-flap", "Signal Flap", "🪽", "yellow", "One button. Fly through the gaps as far as you can.", ["Reflex", "Solo", "Daily"]),
  soon("memory-match", "Memory Match", "🃏", "green", "Flip cards and find every pair before time runs out.", ["Memory", "Solo", "Timed"]),
  soon("pixel-picross", "Pixel Picross", "🖼️", "blue", "Solve the number clues to paint a hidden pixel picture.", ["Logic", "Solo", "Daily"]),
  soon("block-drop", "Block Drop", "🟪", "yellow", "Stack falling blocks and clear lines. The server replays it.", ["Puzzle", "Solo", "Replay"]),
  soon("sudoku", "Sudoku", "🔢", "green", "The classic number puzzle, with a fresh Daily.", ["Logic", "Solo", "Daily"]),
  soon("pong-online", "Pong Online", "🏓", "blue", "Paddles, a ball and a friend on another device.", ["Online", "2 players"]),
  soon("sonar", "Sonar", "🚢", "yellow", "Hide your fleet, ping the grid, sink theirs first.", ["Strategy", "Online"]),
  soon("checkers", "Checkers", "⚫", "green", "Jump, crown and clear the board vs the AI or a friend.", ["Strategy", "AI", "Online"]),
];
