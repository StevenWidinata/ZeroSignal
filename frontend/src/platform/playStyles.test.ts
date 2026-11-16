import { describe, expect, it } from "vitest";
import { countBy, filterGames, loadFilter, sortedStyles, type PlayFilter } from "./playStyles";
import { GAMES, LIVE_GAMES } from "./registry";

/** Words that describe how you play belong in `play`, not in `tags`. */
const PLAY_WORDS = /^(solo|vs ai|ai|1v1|online|daily|2 players|same device|zero-bot)$/i;

const ids = (f: PlayFilter) => filterGames(LIVE_GAMES, f).map((g) => g.meta.id);

describe("play styles", () => {
  it("every game says how it can be played, and its tags don't repeat it", () => {
    for (const g of GAMES) {
      expect(g.meta.play.length, g.meta.id).toBeGreaterThan(0);
      expect(new Set(g.meta.play).size, g.meta.id).toBe(g.meta.play.length);
      for (const t of g.meta.tags) expect(t, `${g.meta.id}: ${t}`).not.toMatch(PLAY_WORDS);
    }
  });

  it("filters the live games", () => {
    expect(ids("all")).toHaveLength(LIVE_GAMES.length);
    expect(ids("online")).toEqual(expect.arrayContaining(["chess", "sonar", "connect-four", "tic-tac-toe"]));
    expect(ids("online")).not.toContain("snake-signal");
    expect(ids("solo")).toEqual(expect.arrayContaining(["snake-signal", "2048", "sling-squad"]));
    expect(ids("daily")).toEqual(
      expect.arrayContaining(["chess", "sonar", "minefield", "2048", "whack-a-mole", "snake-signal"]),
    );
    expect(countBy(LIVE_GAMES, "local")).toBe(ids("local").length);
  });

  it("orders a game's styles like the chips", () => {
    expect(sortedStyles(["daily", "online", "bot"])).toEqual(["bot", "online", "daily"]);
  });

  it("falls back to All without storage", () => {
    expect(loadFilter()).toBe("all");
  });
});
