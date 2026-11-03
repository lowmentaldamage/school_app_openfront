import {
  packA,
  PACKED_UNIT_TYPES,
  unpackALastOwnerID,
  unpackAOwnerID,
  unpackAUnitType,
} from "@laukolaroser/engine-lib/game/PackedUnitUpdates";

describe("packed unit header", () => {
  test("every unit type round-trips with any owner ids", () => {
    // Regression: the type field was 5 bits, so type 32 (Aircraft
    // Carrier) and later decoded as 0.
    expect(PACKED_UNIT_TYPES.length).toBeGreaterThan(31);
    for (const type of PACKED_UNIT_TYPES) {
      for (const [owner, last] of [
        [0, undefined],
        [0xfff - 1, 0],
        [4000, 1234],
      ] as const) {
        const p = packA(owner, last, type);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(unpackAUnitType(p)).toBe(type);
        expect(unpackAOwnerID(p)).toBe(owner);
        expect(unpackALastOwnerID(p)).toBe(last);
      }
    }
  });
});
