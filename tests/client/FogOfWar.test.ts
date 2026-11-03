import { FogOfWar, type FogUnit } from "../../src/client/fog/FogOfWar";

const W = 200;
const H = 100;

function tiles(owner: (x: number, y: number) => number): Uint16Array {
  const t = new Uint16Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) t[y * W + x] = owner(x, y);
  return t;
}

const at = (x: number, y: number) => y * W + x;
let nextId = 1;
const u = (
  unitType: string,
  ownerID: number,
  x: number,
  y: number,
  level = 1,
): FogUnit => ({
  id: nextId++,
  unitType,
  ownerID,
  pos: at(x, y),
  isActive: true,
  level,
});

describe("FogOfWar", () => {
  function setup() {
    // Player 1 owns x < 40, player 2 owns x >= 160, player 3 (ally) none.
    const state = tiles((x) => (x < 40 ? 1 : x >= 160 ? 2 : 0));
    const fog = new FogOfWar(W, H);
    fog.setFriendly([1]);
    fog.updateOwners(state, null);
    return { fog, state };
  }

  test("enemy units are visible only near friendly land", () => {
    const { fog } = setup();
    const near = u("Warship", 2, 45, 50);
    const far = u("Warship", 2, 120, 50);
    fog.computeVisibility([near, far]);
    expect(fog.isUnitVisible(near)).toBe(true);
    expect(fog.isUnitVisible(far)).toBe(false);
  });

  test("own and allied units are always visible; strikes in flight too", () => {
    const { fog } = setup();
    const mine = u("Warship", 1, 120, 50);
    const nuke = u("Atom Bomb", 2, 120, 50);
    fog.computeVisibility([mine]);
    expect(fog.isUnitVisible(mine)).toBe(true);
    expect(fog.isUnitVisible(nuke)).toBe(true);
  });

  test("friendly ships and radar extend sight", () => {
    const { fog } = setup();
    const enemy = u("Transport", 2, 120, 50);
    fog.computeVisibility([]);
    expect(fog.isUnitVisible(enemy)).toBe(false);
    fog.computeVisibility([u("Destroyer", 1, 110, 50)]);
    expect(fog.isUnitVisible(enemy)).toBe(true);
    const farEnemy = u("Transport", 2, 150, 90);
    fog.computeVisibility([u("Radar Station", 1, 38, 50)]);
    expect(fog.isUnitVisible(farEnemy)).toBe(false); // 90-tile radar
    fog.computeVisibility([u("Radar Station", 1, 38, 50, 4)]); // 150 tiles
    expect(fog.isUnitVisible(farEnemy)).toBe(true);
  });

  test("buildings stay on the map once seen", () => {
    const { fog } = setup();
    const city = u("City", 2, 120, 50);
    fog.computeVisibility([u("Destroyer", 1, 115, 50)]);
    expect(fog.isUnitVisible(city)).toBe(true);
    fog.computeVisibility([]);
    expect(fog.isUnitVisible(city)).toBe(true);
    const unseen = u("City", 2, 120, 10);
    expect(fog.isUnitVisible(unseen)).toBe(false);
  });

  test("allies share sight and land changes move the fog", () => {
    const { fog, state } = setup();
    const enemy = u("Warship", 2, 120, 50);
    // Player 3 takes land near the enemy ship.
    const changed: number[] = [];
    for (let y = 40; y < 60; y++)
      for (let x = 110; x < 115; x++) {
        state[at(x, y)] = 3;
        changed.push(at(x, y));
      }
    fog.updateOwners(state, changed);
    fog.computeVisibility([]);
    expect(fog.isUnitVisible(enemy)).toBe(false);
    fog.setFriendly([1, 3]);
    fog.computeVisibility([]);
    expect(fog.isUnitVisible(enemy)).toBe(true);
    // Player 3 loses it again.
    for (const i of changed) state[i] = 0;
    fog.updateOwners(state, changed);
    fog.computeVisibility([]);
    expect(fog.isUnitVisible(enemy)).toBe(false);
  });
});
