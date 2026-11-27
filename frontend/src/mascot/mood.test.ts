import { describe, expect, it } from "vitest";
import { parseSettings } from "../store/settings";
import { PingBrain } from "./engine";
import { MOPE_LINES } from "./lines";
import { CHEER_TO, DECAY_MS, DEFAULT_PING, MOOD_FLOOR, TOUCH_SAVE_MS, isMoping, moodNow, parsePing, petted, touched } from "./mood";

const T0 = 1_800_000_000_000;

describe("Ping's mood", () => {
  it("starts content and never-seen means no decay", () => {
    expect(DEFAULT_PING.mood).toBe(4);
    expect(moodNow(DEFAULT_PING, T0)).toBe(4);
  });

  it("drops one step every 8 hours without attention, never below 1", () => {
    const s = { mood: 5, at: T0 };
    expect(moodNow(s, T0 + DECAY_MS - 1)).toBe(5);
    expect(moodNow(s, T0 + DECAY_MS)).toBe(4);
    expect(moodNow(s, T0 + 3 * DECAY_MS)).toBe(2);
    expect(moodNow(s, T0 + 100 * DECAY_MS)).toBe(MOOD_FLOOR);
    // A clock set backwards changes nothing.
    expect(moodNow(s, T0 - DECAY_MS)).toBe(5);
  });

  it("mopes only at the bottom", () => {
    expect(isMoping(1)).toBe(true);
    expect(isMoping(0)).toBe(true);
    expect(isMoping(2)).toBe(false);
  });

  it("petting cheers him up: +1 a second, at least back to 3, at most 5", () => {
    const low = { mood: 1, at: T0 };
    expect(petted(low, T0, 0.5).mood).toBe(CHEER_TO);
    expect(petted({ mood: 3, at: T0 }, T0, 1.2).mood).toBe(4);
    expect(petted({ mood: 3, at: T0 }, T0, 9).mood).toBe(5);
    expect(petted(low, T0 + 5, 1).at).toBe(T0 + 5);
    // Decay is applied first: 4 → 2 after 16 h, then +1 → still cheered to 3.
    expect(petted({ mood: 4, at: T0 }, T0 + 2 * DECAY_MS, 1).mood).toBe(3);
  });

  it("clicks restart the clock but only save now and then", () => {
    expect(touched({ mood: 4, at: 0 }, T0)).toEqual({ mood: 4, at: T0 });
    expect(touched({ mood: 4, at: T0 }, T0 + 1000)).toBeNull();
    expect(touched({ mood: 4, at: T0 }, T0 + TOUCH_SAVE_MS)).toEqual({ mood: 4, at: T0 + TOUCH_SAVE_MS });
    expect(touched({ mood: 4, at: T0 }, T0 + DECAY_MS)).toEqual({ mood: 3, at: T0 + DECAY_MS });
  });

  it("cleans bad saved values", () => {
    expect(parsePing(null)).toEqual(DEFAULT_PING);
    expect(parsePing("x")).toEqual(DEFAULT_PING);
    expect(parsePing([1])).toEqual(DEFAULT_PING);
    expect(parsePing({ mood: 99, at: -5 })).toEqual({ mood: 5, at: 0 });
    expect(parsePing({ mood: 2.6, at: T0 + 0.5 })).toEqual({ mood: 3, at: T0 });
    expect(parsePing({ mood: "5", at: "now" })).toEqual(DEFAULT_PING);
  });

  it("is saved with the settings, and Lively Ping is on by default", () => {
    const s = parseSettings(JSON.stringify({ ping: { mood: 2, at: T0 }, pingLively: false }));
    expect(s.ping).toEqual({ mood: 2, at: T0 });
    expect(s.pingLively).toBe(false);
    const d = parseSettings(null);
    expect(d.pingLively).toBe(true);
    expect(d.ping).toEqual(DEFAULT_PING);
    expect(parseSettings(JSON.stringify({ ping: "junk", pingLively: "yes" }))).toMatchObject({ ping: DEFAULT_PING, pingLively: true });
  });
});

describe("Ping's moods and carrying", () => {
  it("rests in a mope when moping, and says so when clicked", () => {
    const b = new PingBrain({ random: () => 0.3 });
    b.moping = true;
    expect(b.state().pose).toBe("mope");
    const r = b.click(0);
    expect(MOPE_LINES).toContain(r.line);
    b.startPet();
    expect(b.state().petting).toBe(true);
    expect(b.state().pose).toBeNull();
  });

  it("flaps upright while carried and ignores clicks and petting", () => {
    const b = new PingBrain();
    b.hanging = true;
    b.play("ping");
    b.carry(true);
    const s = b.state();
    expect(s.pose).toBe("flap");
    expect(s.hanging).toBe(false);
    expect(b.click(0)).toEqual({});
    b.startPet();
    expect(b.petting).toBe(false);
    b.carry(false);
    expect(b.state().hanging).toBe(true);
    expect(b.state().pose).toBeNull();
  });
});
