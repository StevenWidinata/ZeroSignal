import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../store/settings";
import { ROW_INFO, SECTION_KEYS, SECTIONS, searchRows, sectionDefaults } from "./sections";

describe("settings rows", () => {
  it("every row belongs to a section and ids are unique", () => {
    const ids = ROW_INFO.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROW_INFO) expect(SECTIONS.some((s) => s.id === r.section)).toBe(true);
  });

  it("search finds settings by name, hint and extra words", () => {
    expect(searchRows("vol", ROW_INFO).map((r) => r.id)).toEqual(expect.arrayContaining(["volume", "uiVolume", "musicVolume"]));
    expect(searchRows("dark mode", ROW_INFO).map((r) => r.id)).toContain("dark");
    expect(searchRows("rebind", ROW_INFO)[0].id).toBe("gameKeys");
    expect(searchRows("password", ROW_INFO)[0].section).toBe("account");
    expect(searchRows("", ROW_INFO)).toEqual([]);
    expect(searchRows("zzz nothing", ROW_INFO)).toEqual([]);
  });

  it("name matches come before hint matches", () => {
    const r = searchRows("music", ROW_INFO);
    expect(r[0].label.toLowerCase()).toContain("music");
  });

  it("each section resets only its own settings to the defaults", () => {
    const sound = sectionDefaults("sound");
    expect(sound).toEqual({
      sound: DEFAULT_SETTINGS.sound,
      volume: DEFAULT_SETTINGS.volume,
      uiVolume: DEFAULT_SETTINGS.uiVolume,
      music: DEFAULT_SETTINGS.music,
      musicVolume: DEFAULT_SETTINGS.musicVolume,
    });
    expect(sectionDefaults("privacy")).toEqual({});
    // No setting is reset by two sections, and every row with a toggle is covered.
    const all = Object.values(SECTION_KEYS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const k of ["textSize", "turnTimer", "rewardToasts", "keys"] as const) expect(all).toContain(k);
  });
});
