import { describe, expect, it } from "vitest";
import { DIZZY_POKES, DURATION, IDLES, PingBrain, TRICKS } from "./engine";
import { IDLE_STATE, OUTLINE, SW, headY, isUpsideDown, renderFrame, type PingState, type Pose } from "./sprite";
import { CLICK_LINES, DIZZY_LINES, JOKES, PET_LINES } from "./lines";
import { NAP_AT } from "./secrets";

const POSES: Pose[] = ["hang", "ping", "echo", "stretch", "flap", "flip", "nap", "dizzy", "mope", "look"];

/** A seeded random so brain tests are repeatable. */
function seeded(seed = 7) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (pose: Pose | null, k = 0.5, extra: Partial<PingState> = {}): PingState => ({
  ...IDLE_STATE,
  pose,
  k,
  at: pose ? DURATION[pose] * k : 0,
  ...extra,
});

function hashFrame(cells: (string | null)[]): number {
  let h = 2166136261;
  for (const c of cells) {
    const s = c ?? ".";
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

describe("Ping's sprite", () => {
  it("draws the same pixels for the same state", () => {
    for (const pose of [null, ...POSES]) {
      const a = renderFrame(at(pose), []);
      const b = renderFrame(at(pose), []);
      expect(hashFrame(a.sprite), String(pose)).toBe(hashFrame(b.sprite));
    }
  });

  it("every pose draws an outlined sprite that fits on the canvas", () => {
    for (const pose of [null, ...POSES]) {
      const f = renderFrame(at(pose), []);
      const filled = f.sprite.filter(Boolean).length;
      expect(filled, String(pose)).toBeGreaterThan(400);
      expect(f.sprite.includes(OUTLINE), String(pose)).toBe(true);
      // Nothing touches the canvas edge (it would be cut off).
      const n = f.size;
      for (let i = 0; i < n; i++) {
        expect(f.sprite[i], `${pose} top`).toBeNull();
        expect(f.sprite[(n - 1) * n + i], `${pose} bottom`).toBeNull();
      }
    }
  });

  it("poses look different from plain idle", () => {
    const idle = hashFrame(renderFrame(at(null), []).sprite);
    for (const pose of ["hang", "stretch", "dizzy", "mope", "nap", "flap"] as Pose[])
      expect(hashFrame(renderFrame(at(pose), []).sprite), pose).not.toBe(idle);
  });

  it("is mirror-symmetric when idle and looking ahead", () => {
    const f = renderFrame(at(null), [], 64, 10, 12);
    const n = f.size;
    let same = 0;
    let total = 0;
    for (let y = 0; y < n; y++)
      for (let x = 10; x <= 10 + SW / 2; x++) {
        const mx = 10 + SW - (x - 10);
        if (f.sprite[y * n + x] || f.sprite[y * n + mx]) {
          total++;
          if (f.sprite[y * n + x] === f.sprite[y * n + mx]) same++;
        }
      }
    // Eye shine and pupils sit a little off-centre on purpose.
    expect(same / total).toBeGreaterThan(0.97);
  });

  it("hangs upside down from the header, and flies upright for a flap", () => {
    expect(isUpsideDown(at(null, 0, { hanging: true }))).toBe(true);
    expect(isUpsideDown(at("ping", 0.5, { hanging: true }))).toBe(true);
    expect(isUpsideDown(at("flap", 0.5, { hanging: true }))).toBe(false);
    expect(isUpsideDown(at("flip", 0.5, { hanging: true }))).toBe(false);
    expect(isUpsideDown(at("flip", 0.1, { hanging: true }))).toBe(true);
    expect(isUpsideDown(at(null))).toBe(false);
    expect(isUpsideDown(at("hang"))).toBe(true);
    expect(headY(at(null, 0, { hanging: true }))).toBeGreaterThan(headY(at(null)));
  });

  it("draws a bar to hang from, which stays when he flies off", () => {
    const bar = (s: PingState) => renderFrame(s, []).fx.filter(Boolean).length;
    expect(bar(at(null))).toBe(0);
    expect(bar(at("hang"))).toBeGreaterThan(0);
    expect(bar(at(null, 0, { hanging: true }))).toBeGreaterThan(0);
    expect(bar(at("flap", 0.5, { hanging: true }))).toBe(bar(at(null, 0, { hanging: true })));
  });

  it("wears a nightcap at night", () => {
    const day = hashFrame(renderFrame(at(null), []).sprite);
    const night = hashFrame(renderFrame(at(null, 0, { night: true }), []).sprite);
    expect(night).not.toBe(day);
  });
});

describe("Ping's behaviour", () => {
  it("starts an idle on his own after a while", () => {
    // A minute: several different idles play.
    const seen = new Set<string>();
    const c = new PingBrain({ random: seeded(3) });
    for (let i = 0; i < 60 * 20; i++) {
      c.update(0.05);
      if (c.pose) seen.add(c.pose);
    }
    expect([...seen].every((p) => IDLES.includes(p as Pose))).toBe(true);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("keeps still with reduced motion", () => {
    const b = new PingBrain({ random: seeded() });
    for (let i = 0; i < 60 * 20; i++) {
      b.update(0.05, true);
      expect(b.pose).toBeNull();
    }
    const r = b.click(1000, true);
    expect(b.pose).toBeNull();
    expect(r.line).toBeTruthy();
  });

  it("never plays the same trick twice in a row", () => {
    const b = new PingBrain({ random: seeded(11) });
    let last: Pose | null = null;
    for (let i = 0; i < NAP_AT - 1; i++) {
      // Far apart, so he never gets dizzy (and before the nap secret).
      b.click(i * 10_000);
      expect(TRICKS).toContain(b.pose);
      expect(b.pose).not.toBe(last);
      last = b.pose;
    }
  });

  it("says something on every trick", () => {
    const b = new PingBrain({ random: seeded(5) });
    for (let i = 0; i < 12; i++) {
      const r = b.click(i * 10_000);
      expect(r.line).toBeTruthy();
      expect(r.sfx).toBeTruthy();
    }
  });

  it("gets dizzy after quick pokes, and ignores clicks while dizzy", () => {
    const b = new PingBrain({ random: seeded() });
    let r = {};
    for (let i = 0; i < DIZZY_POKES; i++) r = b.click(1000 + i * 200);
    expect(b.pose).toBe("dizzy");
    expect(DIZZY_LINES).toContain((r as { line: string }).line);
    expect(b.click(2500)).toEqual({});
    for (let i = 0; i < 40; i++) b.update(0.05);
    expect(b.pose).toBeNull();
  });

  it("slow pokes never make him dizzy", () => {
    const b = new PingBrain({ random: seeded() });
    for (let i = 0; i < 20; i++) {
      b.click(i * 1000);
      expect(b.pose).not.toBe("dizzy");
    }
  });

  it("floats hearts while petted and says thanks after", () => {
    const b = new PingBrain({ random: seeded() });
    b.click(0);
    b.startPet();
    expect(b.pose).toBeNull();
    for (let i = 0; i < 30; i++) b.update(0.05);
    expect(b.particles.some((p) => p.glyph === "heart")).toBe(true);
    expect(b.state().petting).toBe(true);
    const r = b.stopPet();
    expect(PET_LINES).toContain(r.line);
    expect(b.stopPet()).toEqual({});
  });

  it("a fixed pose loops and ignores input", () => {
    const b = new PingBrain({ fixed: "stretch" });
    expect(b.click(0)).toEqual({});
    for (let i = 0; i < 200; i++) b.update(0.05);
    expect(b.pose).toBe("stretch");
  });

  it("particles fade away", () => {
    const b = new PingBrain();
    b.spawn("heart", 10, 10, 0, -10, 0.5);
    for (let i = 0; i < 12; i++) b.update(0.05);
    expect(b.particles).toHaveLength(0);
  });
});

describe("Ping's lines", () => {
  it("are short and calm", () => {
    for (const line of [...JOKES, ...DIZZY_LINES, ...PET_LINES, ...Object.values(CLICK_LINES)]) {
      expect(line.length, line).toBeLessThanOrEqual(60);
      expect(line, line).not.toContain("!");
    }
  });
});
