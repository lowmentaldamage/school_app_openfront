import { hiddenSubmarines } from "../../src/client/render3d/units/UnitKinds";

const W = 100;
const at = (
  id: number,
  unitType: string,
  ownerID: number,
  x: number,
  y: number,
) => ({
  id,
  unitType,
  ownerID,
  pos: y * W + x,
  isActive: true,
});

describe("hiddenSubmarines", () => {
  it("hides enemy subs far from your ships and ports", () => {
    const units = [
      at(1, "Submarine", 2, 50, 50), // enemy, far
      at(2, "Submarine", 2, 12, 10), // enemy, near my warship
      at(3, "Warship", 1, 10, 10), // mine
      at(4, "Submarine", 1, 90, 90), // my own sub: always visible
    ];
    const hidden = hiddenSubmarines(units, 1, W, 30);
    expect([...hidden]).toEqual([1]);
  });

  it("ports spot subs too; spectators see everything", () => {
    const units = [at(1, "Submarine", 2, 50, 50), at(2, "Port", 1, 60, 50)];
    expect(hiddenSubmarines(units, 1, W, 30).size).toBe(0);
    expect(hiddenSubmarines(units, null, W, 30).size).toBe(0);
  });
});
