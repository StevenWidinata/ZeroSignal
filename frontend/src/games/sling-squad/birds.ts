import type { Ability, Bird } from "../../api/types";

// Human-readable ability labels for UI.
export const ABILITY_LABEL: Record<Ability, string> = {
  none: "Balanced",
  dash: "Speed Dash (tap)",
  explode: "Explode (tap)",
  egg_drop: "Egg Drop (tap)",
  heavy: "Heavy Mass",
  split: "Split x3 (tap)",
};

// Does this bird have an active ability triggered mid-flight?
export function hasActiveAbility(ability: Ability): boolean {
  return (
    ability === "dash" ||
    ability === "explode" ||
    ability === "egg_drop" ||
    ability === "split"
  );
}

// Fallback catalog if the API is unreachable (keeps the game playable offline).
export const FALLBACK_BIRDS: Bird[] = [
  {
    id: "pip",
    name: "Pip",
    color: "#FF6B35",
    ability: "none",
    mass: 1.0,
    power: 1.0,
    unlock_score: 0,
    description: "The classic. Balanced mass and power.",
    unlocked: true,
  },
  {
    id: "zip",
    name: "Zip",
    color: "#FFD23F",
    ability: "dash",
    mass: 0.7,
    power: 1.1,
    unlock_score: 2000,
    description: "Speedster. Tap to dash forward.",
    unlocked: false,
  },
  {
    id: "boomer",
    name: "Boomer",
    color: "#4B2A6B",
    ability: "explode",
    mass: 1.6,
    power: 1.0,
    unlock_score: 5000,
    description: "Tap to explode, blasting nearby blocks.",
    unlocked: false,
  },
  {
    id: "eggbert",
    name: "Eggbert",
    color: "#F7E7C6",
    ability: "egg_drop",
    mass: 1.0,
    power: 0.9,
    unlock_score: 9000,
    description: "Tap to drop an egg bomb straight down.",
    unlocked: false,
  },
  {
    id: "tank",
    name: "Tank",
    color: "#7A3E1D",
    ability: "heavy",
    mass: 2.6,
    power: 1.0,
    unlock_score: 15000,
    description: "Huge mass. Smashes through everything.",
    unlocked: false,
  },
  {
    id: "trio",
    name: "Trio",
    color: "#2EC4B6",
    ability: "split",
    mass: 0.6,
    power: 1.0,
    unlock_score: 22000,
    description: "Tap to split into three birds.",
    unlocked: false,
  },
];
