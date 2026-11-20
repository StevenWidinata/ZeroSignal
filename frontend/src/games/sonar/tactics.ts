/**
 * Sonar Tactics settings and power charges: a copy of backend/src/sonar/tactics.rs,
 * reading the same shared/sonar_tactics.json. See that file for the rules.
 */
import raw from "../../../../shared/sonar_tactics.json";

export interface PowerLevel {
  cooldown: number;
  size: number;
}

export interface PowerSpec {
  id: string;
  ship: string;
  name: string;
  icon: string;
  code: string;
  text: string;
  levels: PowerLevel[];
}

export interface ItemSpec {
  id: Item;
  name: string;
  icon: string;
  text: string;
}

/** What a supply crate holds. */
export type Item = "ping" | "shield" | "repair" | "extra_shot";

const TACTICS = raw as { mines: number; crates: number; combo: number; items: ItemSpec[]; powers: PowerSpec[] };
export const POWERS = TACTICS.powers;
export const ITEMS = TACTICS.items;
/** Mines each side may hide; crates hidden in each sea; hits in a row for Overdrive. */
export const MINES = TACTICS.mines;
export const CRATES = TACTICS.crates;
export const COMBO = TACTICS.combo;
export const AIR_STRIKE = 0;
export const SALVO = 1;
export const RADAR = 2;
export const TORPEDO = 3;
export const FLARE = 4;
/** The ship that runs silent (the submarine), by fleet index. */
export const SILENT_SHIP = 3;
export const MAX_LEVEL = 3;

/** Mk levels (1–3) for one side's five powers. */
export type Levels = number[];
export const MK1: Levels = [1, 1, 1, 1, 1];

/** A power's numbers at Mk `level` (clamped to 1–3). */
export function powerLevel(power: number, level: number): PowerLevel {
  return POWERS[power].levels[Math.min(MAX_LEVEL, Math.max(1, level)) - 1];
}

/** How a Tactics game is set up: Mk levels, the crate seed, crates per sea (like `Setup` in tactics.rs). */
export interface Setup {
  levels: [Levels, Levels];
  seed: number;
  crates: number;
}

/** Both sides' power charges, combo counts and Overdrive (like `Tactics` in tactics.rs). */
export class Tactics {
  readonly levels: [Levels, Levels];
  charge: [number[], number[]];
  /** Firing moves in a row that hit. */
  combo: [number, number] = [0, 0];
  /** A full Overdrive, ready to spend. */
  overdrive: [boolean, boolean] = [false, false];

  constructor(levels: [Levels, Levels]) {
    this.levels = levels;
    this.charge = [0, 1].map((s) => POWERS.map((_, p) => Math.floor(powerLevel(p, levels[s][p]).cooldown / 2))) as [number[], number[]];
  }

  spec(side: number, power: number): PowerLevel {
    return powerLevel(power, this.levels[side][power]);
  }

  ready(side: number, power: number): boolean {
    return this.charge[side][power] >= this.spec(side, power).cooldown;
  }

  /** After `side` moved: the power it used (if any) starts over, the rest charge up. */
  afterMove(side: number, used: number | null) {
    this.charge[side] = this.charge[side].map((c, p) => (used === p ? 0 : Math.min(c + 1, this.spec(side, p).cooldown)));
  }

  /** After a firing move by `side`: count the combo and fill Overdrive. */
  afterFiring(side: number, hit: boolean) {
    if (!hit) {
      this.combo[side] = 0;
      return;
    }
    this.combo[side] = Math.min(this.combo[side] + 1, COMBO);
    if (this.combo[side] === COMBO && !this.overdrive[side]) {
      this.overdrive[side] = true;
      this.combo[side] = 0;
    }
  }

  /** Spend Overdrive to charge `power` right away. */
  spendOverdrive(side: number, power: number) {
    this.overdrive[side] = false;
    this.charge[side][power] = this.spec(side, power).cooldown;
  }
}
