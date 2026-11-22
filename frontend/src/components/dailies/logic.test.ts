import { describe, expect, it } from "vitest";
import { dailyLink, shareText, wantsDaily, wibDate } from "./logic";

describe("dailies", () => {
  it("links straight to each Daily", () => {
    expect(dailyLink("snake-signal")).toBe("/play/snake-signal?daily=1");
    expect(dailyLink("chess")).toBe("/play/chess?mode=puzzle");
    expect(wantsDaily("?daily=1")).toBe(true);
    expect(wantsDaily("?room=AB")).toBe(false);
  });

  it("builds the share text", () => {
    const text = shareText({
      icon: "🐍",
      title: "Snake Signal",
      date: "2026-11-16",
      headline: "1,840 pts",
      detail: "📏 46 long · 🔥 ×5",
      rank: 3,
      players: 12,
      url: "https://example.test/play/snake-signal?daily=1",
    });
    expect(text).toBe(
      "🐍 Snake Signal Daily 2026-11-16\n1,840 pts · #3 of 12\n📏 46 long · 🔥 ×5\nhttps://example.test/play/snake-signal?daily=1",
    );
    expect(shareText({ icon: "x", title: "T", date: "d", headline: "h", url: "u" })).toBe("x T Daily d\nh\nu");
  });

  it("uses the WIB day", () => {
    // 18:00 UTC is already the next day in WIB (UTC+7).
    expect(wibDate(new Date("2026-11-15T18:00:00Z"))).toBe("2026-11-16");
    expect(wibDate(new Date("2026-11-15T16:59:00Z"))).toBe("2026-11-15");
  });
});
