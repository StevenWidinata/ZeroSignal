import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const echoRally: GameModule = {
  meta: {
    id: "echo-rally",
    title: "Echo Rally",
    tagline: "Paddles, a ball and Chaos powers, against Zero-Bot or a friend online.",
    tags: ["Arcade", "Real-time"],
    play: ["bot", "online"],
    accent: "blue",
    icon: "🏓",
    status: "live",
    scoreLabel: "Points",
    boards: [{ level: 1, label: "vs Zero-Bot" }],
    tutorial: [
      {
        icon: "🏓",
        title: "Keep the ball in play",
        text: "Move your paddle with the mouse, a finger on the court, or the Up and Down keys. Miss the ball and the other side scores.",
      },
      {
        icon: "📐",
        title: "Aim with the paddle",
        text: "Hit the ball with the middle of the paddle to send it straight, near the edge for a steep angle. Every return makes it a little faster.",
      },
      {
        icon: "⚡",
        title: "Chaos powers",
        text: "In Chaos you bring 3 powers and fire each one once per match with 1, 2 and 3 or the buttons under the court. Zero-Bot brings some too.",
      },
      {
        icon: "🏆",
        title: "First to the target",
        text: "Play to 5, 7 or 11. A win adds the bot's level times the points to your board total. The server replays every match.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default echoRally;
