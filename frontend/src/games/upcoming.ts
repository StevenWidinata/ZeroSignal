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
  soon("pixel-picross", "Pixel Picross", "🖼️", "blue", "Solve the number clues to paint a hidden pixel picture.", ["Logic", "Pictures"], ["solo", "daily"]),
  soon("block-drop", "Block Drop", "🟪", "yellow", "Stack falling blocks and clear lines. The server replays it.", ["Puzzle", "Replay"], ["solo"]),
  soon("echo-rally", "Echo Rally", "🏓", "blue", "Paddles, a ball and Chaos powers, against Zero-Bot or a friend online.", ["Arcade", "Real-time"], ["bot", "online"]),
];
