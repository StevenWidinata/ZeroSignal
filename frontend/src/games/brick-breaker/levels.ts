/**
 * The 24 Campaign levels from `shared/brick_levels.json`, turned into brick
 * layouts exactly like `backend/src/brick_breaker/levels.rs` does (the shared
 * vectors replay real levels on both sides to prove it).
 */
import FILE from "../../../../shared/brick_levels.json";
import type { BrickSpec, Drop, Kind, Level } from "./engine";

export interface CampaignLevel {
  world: number;
  level: Level;
}

interface LevelFile {
  id: number;
  world: number;
  name: string;
  speed: number;
  map: string[];
  drops: [number, number, string][];
  moving: [number, number, string, number, number, number][];
}

function kindOf(ch: string): [Kind, number | undefined] | null {
  switch (ch) {
    case "n":
      return ["n", undefined];
    case "t":
      return ["t", 2];
    case "T":
      return ["t", 3];
    case "s":
      return ["s", undefined];
    case "e":
      return ["e", undefined];
    default:
      return null;
  }
}

function spec(c: number, r: number, k: [Kind, number | undefined]): BrickSpec {
  const s: BrickSpec = { c, r, t: k[0] };
  if (k[1] !== undefined) s.hp = k[1];
  return s;
}

function convert(f: LevelFile): CampaignLevel {
  const bricks: BrickSpec[] = [];
  f.map.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const k = kindOf(ch);
      if (k) bricks.push(spec(c, r, k));
    });
  });
  for (const [c, r, k, lo, hi, speed] of f.moving) {
    const b = spec(c, r, kindOf(k[0] ?? "n") ?? ["n", undefined]);
    b.m = [lo, hi, speed];
    bricks.push(b);
  }
  for (const [c, r, d] of f.drops) {
    const b = bricks.find((x) => x.c === c && x.r === r);
    if (b) b.d = d as Drop;
  }
  return { world: f.world, level: { id: f.id, name: f.name, speed: f.speed, bricks } };
}

export const LEVELS: CampaignLevel[] = (FILE.levels as LevelFile[]).map(convert);
export const LEVEL_COUNT = LEVELS.length;

export function levelById(id: number): Level | null {
  return LEVELS.find((l) => l.level.id === id)?.level ?? null;
}
