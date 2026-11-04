import { describe, expect, it } from "vitest";
import {
  atPowerTier,
  explosionFor,
  strikeTierFor,
} from "../../src/client/render3d/effects/ExplosionSpecs";

describe("explosionFor", () => {
  it("nukes detonate on impact, hydrogen bigger than atom", () => {
    const atom = explosionFor("Atom Bomb", true)!;
    const h = explosionFor("Hydrogen Bomb", true)!;
    expect(atom.kind).toBe("nuke");
    expect(h.radius).toBeGreaterThan(atom.radius);
  });

  it("intercepted nukes burst in the air", () => {
    const e = explosionFor("Atom Bomb", false)!;
    expect(e.kind).toBe("airburst");
    expect(e.altitude).toBeGreaterThan(0);
  });

  it("docking ships vanish, sunk ships explode", () => {
    expect(explosionFor("Transport", true)).toBeNull();
    expect(explosionFor("Trade Ship", true)).toBeNull();
    expect(explosionFor("Warship", false)?.kind).toBe("ship");
  });

  it("destroyed buildings explode; the MIRV carrier itself does not", () => {
    expect(explosionFor("City", false)?.kind).toBe("building");
    expect(explosionFor("MIRV", true)).toBeNull();
  });

  it("ignores unknown types", () => {
    expect(explosionFor("Nonsense", false)).toBeNull();
  });
});

describe("strike power tiers", () => {
  it("Mk I is unchanged; higher tiers blow bigger", () => {
    const shell = explosionFor("Artillery Shell", true)!;
    expect(atPowerTier(shell, 1)).toEqual(shell);
    const mk2 = atPowerTier(shell, 2);
    const mk3 = atPowerTier(shell, 3);
    expect(mk2.radius).toBeGreaterThan(shell.radius);
    expect(mk3.radius).toBeGreaterThan(mk2.radius);
    expect(mk3.intensity).toBeGreaterThan(mk2.intensity);
    expect(mk3.kind).toBe(shell.kind);
  });

  it("reads the right weapon's tier", () => {
    const tiers = { artillery: 1, naval: 3, airstrike: 2, rocket: 2 };
    expect(strikeTierFor("Rocket", tiers)).toBe(2);
    expect(strikeTierFor("Artillery Shell", tiers)).toBe(3);
    expect(strikeTierFor("Atom Bomb", tiers)).toBe(1);
  });
});
