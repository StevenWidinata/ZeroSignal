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
        icon: "⚡",
        title: "Tactics: ship powers",
        text: "In Tactics every ship has a power that recharges as you play: Air Strike (Carrier), Salvo (Battleship), Radar Sweep (Cruiser), Torpedo (Submarine, which also hides from pings and radar) and Flare (Destroyer). Lose a ship and its power is gone.",
      },
      {
        icon: "💣",
        title: "Mines, crates and Overdrive",
        text: "Hide 2 mines in your sea: whoever fires on one shows you where one of their ships is. Hidden crates give an extra ping, a shield, a repair kit or an extra shot. Hit 3 times in a row to fill Overdrive and charge a power at once.",
      },
      {
        icon: "🎖️",
        title: "Workshop and Campaign",
        text: "Spend coins in the Workshop to upgrade powers to Mk II and Mk III (they count vs Zero-Bot and in the Campaign). The Campaign has 12 missions with twists: win one for up to 3 stars, and every new star pays coins.",
      },
      {
        icon: "🤖",
        title: "Pick your battle",
        text: "Play Zero-Bot from Easy to Master in Classic or Tactics, the Campaign, the Daily Hunt (same fleet for everyone), a friend online, or pass and play on one device.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default sonar;
