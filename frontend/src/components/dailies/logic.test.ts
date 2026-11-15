import { describe, expect, it } from "vitest";
import type { DailyView } from "../../api/types";
import { dailyLine, dailyLink, doneCount, wantsDaily } from "./logic";

const d = (patch: Partial<DailyView>): DailyView => ({
  game_id: "snake-signal",
  board: 4,
  status: "new",
  score: null,
  rank: null,
  players: 0,
  ...patch,
});

describe("today's dailies", () => {
  it("describes each state", () => {
    expect(dailyLine(d({})).action).toBe("play");
    expect(dailyLine(d({ status: "playing" })).action).toBe("continue");
    expect(dailyLine(d({ status: "done", score: 0, rank: 1 })).text).toBe("✓ Done for today");
    expect(dailyLine(d({ status: "done", score: 1840, rank: 3, players: 12 })).text).toBe("✓ 1,840 pts · #3 of 12");
    // A guest isn't counted in players but still sees where they'd be.
    expect(dailyLine(d({ status: "done", score: 900, rank: 2, players: 1 })).text).toBe("✓ 900 pts · #2 of 2");
  });

  it("links straight to each Daily", () => {
    expect(dailyLink("snake-signal")).toBe("/play/snake-signal?daily=1");
    expect(dailyLink("chess")).toBe("/play/chess?mode=puzzle");
    expect(wantsDaily("?daily=1")).toBe(true);
    expect(wantsDaily("?room=AB")).toBe(false);
  });

  it("counts finished dailies", () => {
    expect(doneCount([d({ status: "done" }), d({}), d({ status: "playing" })])).toBe("1 of 3 done");
  });
});
