import { describe, expect, it } from "vitest";
import { explosionFor } from "../../src/client/render3d/effects/ExplosionSpecs";

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
