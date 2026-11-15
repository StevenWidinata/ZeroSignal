import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Avatar from "./Avatar";
import { EMOTES, ZERO_BOT, gameResult } from "./Live";
import { findItem } from "./catalog";

const html = (props: Parameters<typeof Avatar>[0]) => renderToStaticMarkup(<Avatar {...props} />);

describe("living characters", () => {
  it("static by default: no animation classes or eyelids", () => {
    const h = html({ loadout: null });
    expect(h).not.toContain("av-live");
    expect(h).not.toContain("av-lids");
  });

  it("animated: breathing figure, blinking lids and the pose class", () => {
    const h = html({ loadout: null, animated: true, pose: "think" });
    expect(h).toContain("av-live av-think");
    expect(h).toContain("av-figure");
    expect(h).toContain("av-lids");
  });

  it("waving raises the right arm; cheering raises both", () => {
    const wave = html({ loadout: null, animated: true, pose: "wave" });
    expect(wave).toContain("av-arm-r");
    expect(wave).not.toContain("av-arm-l");
    const cheer = html({ loadout: null, animated: true, pose: "cheer" });
    expect(cheer).toContain("av-arm-r");
    expect(cheer).toContain("av-arm-l");
    expect(html({ loadout: null, animated: true, pose: "sad" })).not.toContain("av-arm");
  });

  it("Zero-Bot only uses real catalog items", () => {
    for (const id of Object.values(ZERO_BOT)) expect(findItem(id), id).toBeTruthy();
  });

  it("emotes and game results", () => {
    expect(EMOTES.map((e) => e.emoji)).toEqual(["👋", "😀", "😮", "😢", "🔥"]);
    expect(gameResult({ game_over: false, outcome: { kind: "ongoing" } })).toBeNull();
    expect(gameResult({ game_over: true, outcome: { kind: "win", winner: "p1" } })).toBe("win");
    expect(gameResult({ game_over: true, outcome: { kind: "win", winner: "p2" } })).toBe("loss");
    expect(gameResult({ game_over: true, outcome: { kind: "draw" } })).toBe("draw");
  });
});
