/** The Campaign missions (shared/sonar_campaign.json, also read by the server). */
import raw from "../../../../shared/sonar_campaign.json";
import type { SonarLevel } from "../../api/types";

export interface Mission {
  id: number;
  name: string;
  brief: string;
  level: SonarLevel;
  bot_mk: number;
  fog: boolean;
  silent: boolean;
  bot_mines: number;
  /** [in your sea, in Zero-Bot's sea] */
  crates: number[];
  bot_shields: number;
  no_powers: boolean;
  move_limit: number | null;
  star_moves: number;
}

const DATA = raw as { star_coins: number; ops: Mission[] };
export const MISSIONS = DATA.ops;
export const STAR_COINS = DATA.star_coins;
export const missionById = (id: number | null | undefined) => MISSIONS.find((m) => m.id === id) ?? null;

/** Short tags for a mission's twists ("Fog", "6 mines", "45 moves", …). */
export function twistTags(m: Mission): string[] {
  const t: string[] = [];
  if (m.fog) t.push("🌫️ Fog");
  if (m.silent) t.push("🔇 Silent fleet");
  if (m.bot_mines !== 2) t.push(`💣 ${m.bot_mines} mines`);
  if (m.crates[1] !== 3) t.push(`📦 ${m.crates[1]} crates`);
  if (m.bot_shields) t.push(`🛡️ ${m.bot_shields} shields`);
  if (m.no_powers) t.push("🚫 No powers");
  if (m.move_limit) t.push(`⏱️ ${m.move_limit} moves`);
  if (m.bot_mk > 1) t.push(`Zero-Bot Mk ${"I".repeat(m.bot_mk)}`);
  return t;
}

/** The three stars of a mission, as words. */
export const starGoals = (m: Mission) => ["Win", `Win in ${m.star_moves} moves or fewer`, "Win without losing a ship"];
