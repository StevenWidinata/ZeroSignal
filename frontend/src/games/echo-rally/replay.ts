/**
 * The replay of a match against Zero-Bot, like `replay` in
 * `backend/src/echo_rally/engine.rs` (kept apart from engine.ts so the
 * engine and the bot don't import each other).
 */
import { Bot, botKit } from "./bot";
import { FIRE_0, Game, kitOk, rules, type Control, type Input, type Power, type Summary } from "./engine";

export type ReplayError =
  | "bad_match"
  | "bad_kit"
  | "too_many_inputs"
  | "unsorted"
  | "bad_input"
  | "duplicate"
  | "bad_fire"
  | "after_end";

/** A match against Zero-Bot: the player is side 0 (left), the bot side 1. */
export interface BotMatch {
  seed: number;
  target: number;
  /** 0 easy .. 3 master. */
  level: number;
  chaos: boolean;
  /** The player's kit (empty in Classic). */
  kit: Power[];
}

export function checkMatch(m: BotMatch): ReplayError | null {
  const r = rules;
  if (!r.targets.includes(m.target) || !Number.isInteger(m.level) || m.level < 0 || m.level >= r.bot.length) {
    return "bad_match";
  }
  const ok = m.chaos ? kitOk(m.kit) : m.kit.length === 0;
  return ok ? null : "bad_kit";
}

/** The court at tick 0 and the bot that plays side 1. */
export function startMatch(m: BotMatch): { game: Game; bot: Bot } {
  const kit = m.chaos ? botKit(m.seed, m.level) : [];
  const game = new Game(m.seed, m.target, [m.kit, kit]);
  const bot = new Bot(m.seed, 1, m.level, game);
  return { game, bot };
}

/** Plays a whole match from the player's inputs, like the server. */
export function replay(m: BotMatch, inputs: Input[], stopAt: number | null = null): Summary | ReplayError {
  const r = rules;
  const bad = checkMatch(m);
  if (bad) return bad;
  if (inputs.length > r.max_inputs) return "too_many_inputs";
  // The server only accepts whole numbers (its JSON types are u32 and i32).
  if (inputs.some(([t, v]) => !Number.isInteger(t) || t < 0 || !Number.isInteger(v))) return "bad_input";
  for (let k = 1; k < inputs.length; k++) if (inputs[k][0] < inputs[k - 1][0]) return "unsorted";
  const min = FIRE_0 - (r.kit_size - 1);
  if (inputs.some(([, v]) => v < min || v > r.height)) return "bad_input";
  const fired = new Array<boolean>(r.kit_size).fill(false);
  for (const [, v] of inputs) {
    if (v < 0) {
      const slot = FIRE_0 - v;
      if (slot >= m.kit.length || fired[slot]) return "bad_fire";
      fired[slot] = true;
    }
  }
  const { game: g, bot } = startMatch(m);
  let i = 0;
  while (g.over === null) {
    if (stopAt !== null && g.tick >= stopAt) {
      g.quit(0);
      break;
    }
    const me: Control = { target: null, fire: null };
    while (i < inputs.length && inputs[i][0] === g.tick) {
      const v = inputs[i][1];
      if (v < 0) {
        if (me.fire !== null) return "duplicate";
        me.fire = FIRE_0 - v;
      } else {
        if (me.target !== null) return "duplicate";
        me.target = v;
      }
      i += 1;
    }
    const them = bot.control(g);
    g.step([me, them]);
  }
  if (i < inputs.length) return "after_end";
  return g.s;
}
