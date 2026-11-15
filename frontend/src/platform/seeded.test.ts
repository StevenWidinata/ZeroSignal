import { describe, expect, it } from "vitest";
import { Rng } from "./seeded";

describe("seeded rng", () => {
  it("matches backend/src/rng.rs", () => {
    const r = new Rng(12345);
    expect([r.nextU32(), r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([4207900869, 1317490944, 2079646450, 3513001552]);
  });
});
