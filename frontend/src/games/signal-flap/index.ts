import { lazy } from "react";
import type { GameModule } from "../../platform/types";

const signalFlap: GameModule = {
  meta: {
    id: "signal-flap",
    title: "Signal Flap",
    tagline: "One button. Fly the drone through the tower gaps as far as you can.",
    tags: ["Reflex", "One button"],
    play: ["solo", "daily"],
    accent: "yellow",
    icon: "📡",
    status: "live",
    scoreLabel: "Best score",
    detailLabel: "Gaps",
    boards: [
      { level: 1, label: "Endless" },
      { level: 2, label: "Today's Daily", period: "today" },
    ],
    tutorial: [
      {
        icon: "📡",
        title: "Flap to fly",
        text: "Click or tap the board, or press Space, to flap. The drone hovers until your first flap, so start when you're ready.",
      },
      {
        icon: "🗼",
        title: "Through the gaps",
        text: "Fly through the gap in each antenna tower. Touching a tower, the ground or the top of the sky ends the run.",
      },
      {
        icon: "📶",
        title: "Grab signal bars",
        text: "Every gap and every signal bar is 1 point. The gaps get narrower and faster as you go, and some start to slide.",
      },
      {
        icon: "📅",
        title: "Endless and Daily",
        text: "Fly as far as you can in Endless, or take today's Daily: the same course for everyone, one try. The server replays every run.",
      },
    ],
  },
  Play: lazy(() => import("./Play")),
};

export default signalFlap;
