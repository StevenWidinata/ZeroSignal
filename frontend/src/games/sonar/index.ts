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
        title: "Fire and ping",
        text: "Take turns picking a square on the other sea: ✕ is a hit, • is a miss. Hit every square of a ship to sink it. Twice a game you can ping instead: it counts the ship squares in the 3×3 area around a square.",
      },
      {
        icon: "⚡",
        title: "Tactics",
        text: "Every ship gets a power that recharges as you play: Air Strike, Salvo, Radar Sweep, Torpedo and Flare. Lose the ship and its power is gone. You also hide 2 mines, crates hold extra items, and 3 hits in a row fill Overdrive to charge a power at once.",
      },
      {
        icon: "🤖",
        title: "Pick your battle",
        text: "Zero-Bot from Easy to Master (Classic or Tactics), the 12-mission Campaign with stars, the Daily Hunt, a friend online, or one device. Upgrade your powers to Mk II and Mk III in the Workshop.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default sonar;
