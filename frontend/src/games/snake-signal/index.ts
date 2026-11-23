import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const snakeSignal: GameModule = {
  meta: {
    id: "snake-signal",
    title: "Snake Signal",
    tagline: "Grow the snake, grab power-ups, don't bite your tail.",
    tags: ["Arcade", "Power-ups"],
    play: ["solo", "daily"],
    accent: "green",
    icon: "🐍",
    status: "live",
    scoreLabel: "Best score",
    detailLabel: "Longest",
    boards: [
      { level: 1, label: "🧱 Classic" },
      { level: 2, label: "🌀 Wrap" },
      { level: 4, label: "📅 Today's Daily", period: "today" },
    ],
    tutorial: [
      {
        icon: "🐍",
        title: "Steer the signal",
        text: "Arrow keys or WASD turn the snake. On a phone, swipe on the board or turn on the D-pad. Eat ◆ data packets to grow.",
      },
      {
        icon: "🔥",
        title: "Chain your combo",
        text: "Eat packets quickly one after another for ×2, ×3, then ×5 points. Turning away right before a wall or your tail scores a close call.",
      },
      {
        icon: "⚡",
        title: "Power-ups and glitches",
        text: "Boost doubles points, Phase slides through your tail, Magnet pulls packets, Slow-mo slows time, Snip halves your tail. Avoid glitch blocks and the 👾 bug (eat it while Boosted!).",
      },
      {
        icon: "📶",
        title: "Keep the signal",
        text: "Your signal fades over time and packets refill it. Play Classic, Wrap (no walls) or today's Daily. The server replays every turn.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default snakeSignal;
