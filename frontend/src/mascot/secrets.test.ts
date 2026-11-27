import { describe, expect, it } from "vitest";
import { PingBrain } from "./engine";
import { NAP_LINE, NIGHT_LINES, WAKE_LINES } from "./lines";
import { NAP_AT, echoKey, isNight } from "./secrets";

const typed = (keys: string[]) => {
  let buf = "";
  const hits: number[] = [];
  keys.forEach((k, i) => {
    const r = echoKey(buf, k);
    buf = r.buf;
    if (r.hit) hits.push(i);
  });
  return hits;
};

describe("Ping's secrets", () => {
  it("naps on the 10th click of a visit, and a click wakes him", () => {
    const b = new PingBrain({ random: () => 0.4 });
    for (let i = 1; i < NAP_AT; i++) {
      b.click(i * 10_000);
      expect(b.pose).not.toBe("nap");
    }
    const r = b.click(NAP_AT * 10_000);
    expect(b.pose).toBe("nap");
    expect(r.line).toBe(NAP_LINE);
    expect(r.sfx).toBe("batYawn");
    // Zzz rise while he sleeps.
    for (let i = 0; i < 40; i++) b.update(0.05);
    expect(b.particles.some((p) => p.glyph === "z")).toBe(true);
    const w = b.click((NAP_AT + 1) * 10_000);
    expect(WAKE_LINES).toContain(w.line);
    expect(b.pose).toBe("flap");
    // Only once a visit.
    for (let i = 0; i < 30; i++) {
      b.click((NAP_AT + 2 + i) * 10_000);
      expect(b.pose).not.toBe("nap");
    }
  });

  it("answers when you type ping", () => {
    expect(typed([..."ping"])).toEqual([3]);
    expect(typed([..."PiNg"])).toEqual([3]);
    expect(typed([..."xxpingping"])).toEqual([5, 9]);
    expect(typed([..."pin", "Shift", "g"])).toEqual([]);
    expect(typed([..."pong"])).toEqual([]);
    expect(typed(["p", "i", "n", "ArrowUp", "g"])).toEqual([]);
  });

  it("is a night owl from midnight to 5 am", () => {
    expect(isNight(new Date(2026, 10, 27, 0, 0))).toBe(true);
    expect(isNight(new Date(2026, 10, 27, 4, 59))).toBe(true);
    expect(isNight(new Date(2026, 10, 27, 5, 0))).toBe(false);
    expect(isNight(new Date(2026, 10, 27, 23, 59))).toBe(false);
  });

  it("yawns more and says sleepy things at night", () => {
    const count = (night: boolean) => {
      const b = new PingBrain();
      b.night = night;
      let stretches = 0;
      for (let i = 0; i < 400; i++) {
        b.idle();
        if (b.pose === "stretch") stretches++;
      }
      return stretches;
    };
    expect(count(true)).toBeGreaterThan(count(false));
    const b = new PingBrain();
    b.night = true;
    const said = Array.from({ length: 80 }, () => b.chatter());
    expect(said.some((l) => NIGHT_LINES.includes(l))).toBe(true);
  });
});
