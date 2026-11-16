import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const sonar: GameModule = {
  meta: {
    id: "sonar",
    title: "Sonar",
    tagline: "Hide your fleet, ping the grid, sink theirs first.",
    tags: ["Strategy", "Pings"],
    play: ["bot", "online", "local", "daily"],
    accent: "yellow",
    icon: "🚢",
    status: "live",
    isNew: true,
    scoreLabel: "Points",
    boards: [
      { label: "🚢 All points" },
      { level: 5, label: "📅 Today's hunt", period: "today" },
    ],
    tutorial: [
      {
        icon: "🚢",
        title: "Hide your fleet",
        text: "Place your 5 ships on your grid (or press Shuffle). Ships lie in straight lines and can't touch, not even corner to corner.",
      },
      {
        icon: "🎯",
        title: "Fire!",
        text: "Take turns picking a square on the other sea. ✕ is a hit, • is a miss. Hit every square of a ship to sink it; the water around it is then shown.",
      },
      {
        icon: "📡",
        title: "Sonar pings",
        text: "Twice a game you can ping instead of firing: it tells you how many ship squares are in the 3×3 area around a square.",
      },
      {
        icon: "🤖",
        title: "Pick your battle",
        text: "Play Zero-Bot from Easy to Master, the Daily Hunt (same fleet for everyone), a friend online, or pass and play on one device.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default sonar;
