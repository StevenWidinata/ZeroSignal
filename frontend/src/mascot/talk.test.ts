import { describe, expect, it } from "vitest";
import { pingBus, pingResult, type PingEvent } from "./bus";
import { PingBrain } from "./engine";
import { GAME_TIPS, JOKES, NUDGES, PAGE_TIPS, REACTIONS, tipsFor } from "./lines";
import { NUDGE_GAP_MS, nudgesAllowed, pickNudge, relevantHere } from "./nudge";

const NOW = 1_800_000_000_000;
const GAMES = ["2048", "brick-breaker", "checkers", "chess", "connect-four", "memory-match", "minefield", "signal-flap", "sling-squad", "snake-signal", "sonar", "sudoku", "tic-tac-toe", "whack-a-mole"];

describe("nudges", () => {
  it("picks the most important open one", () => {
    expect(pickNudge({ prize: true, quests: true, daily: true }, {}, NOW)).toBe("prize");
    expect(pickNudge({ quests: true, daily: true }, {}, NOW)).toBe("quests");
    expect(pickNudge({ daily: true }, {}, NOW)).toBe("daily");
    expect(pickNudge({}, {}, NOW)).toBeNull();
  });

  it("says each one at most once an hour", () => {
    const open = { prize: true, daily: true };
    expect(pickNudge(open, { prize: NOW - 1000 }, NOW)).toBe("daily");
    expect(pickNudge(open, { prize: NOW - 1000, daily: NOW - 1000 }, NOW)).toBeNull();
    expect(pickNudge(open, { prize: NOW - NUDGE_GAP_MS }, NOW)).toBe("prize");
    // A time in the future (clock changed) doesn't block forever.
    expect(pickNudge(open, { prize: NOW + 10 * NUDGE_GAP_MS }, NOW)).toBe("prize");
  });

  it("stays quiet in games and on sign-in pages, and skips the page it's about", () => {
    expect(nudgesAllowed("/")).toBe(true);
    expect(nudgesAllowed("/shop")).toBe(true);
    expect(nudgesAllowed("/play/chess")).toBe(false);
    expect(nudgesAllowed("/login")).toBe(false);
    expect(nudgesAllowed("/register")).toBe(false);
    expect(nudgesAllowed("/players")).toBe(true);
    expect(relevantHere("quests", "/quests")).toBe(false);
    expect(relevantHere("quests", "/")).toBe(true);
  });
});

describe("tips", () => {
  it("has tips for every game", () => {
    for (const g of GAMES) {
      expect(GAME_TIPS[g]?.length, g).toBeGreaterThan(0);
      expect(tipsFor(`/play/${g}`)).toBe(GAME_TIPS[g]);
    }
  });

  it("finds the tips for each page", () => {
    expect(tipsFor("/")).toBe(PAGE_TIPS.hub);
    expect(tipsFor("/leaderboard/chess")).toBe(PAGE_TIPS.leaderboard);
    expect(tipsFor("/shop")).toBe(PAGE_TIPS.shop);
    expect(tipsFor("/u/someone")).toBe(PAGE_TIPS.profile);
    expect(tipsFor("/register")).toBe(PAGE_TIPS.account);
    expect(tipsFor("/nowhere")).toEqual([]);
    expect(tipsFor("/play/unknown-game")).toEqual([]);
  });

  it("mixes tips with jokes when he chats", () => {
    const b = new PingBrain();
    b.tips = ["TIP"];
    const said = new Set(Array.from({ length: 60 }, () => b.chatter()));
    expect(said.has("TIP")).toBe(true);
    expect([...said].some((l) => JOKES.includes(l))).toBe(true);
    b.tips = [];
    for (let i = 0; i < 20; i++) expect(JOKES).toContain(b.chatter());
  });

  it("every line is short and calm", () => {
    const all = [...Object.values(PAGE_TIPS).flat(), ...Object.values(GAME_TIPS).flat(), ...Object.values(REACTIONS).flat(), ...Object.values(NUDGES)];
    for (const line of all) {
      expect(line.length, line).toBeLessThanOrEqual(60);
      expect(line, line).not.toContain("!");
    }
  });
});

describe("the event bus", () => {
  it("delivers results to listeners until they unsubscribe", () => {
    const got: PingEvent[] = [];
    const off = pingBus.on((e) => got.push(e));
    pingResult("best");
    off();
    pingResult("sad");
    expect(got).toEqual([{ type: "result", kind: "best" }]);
  });
});
