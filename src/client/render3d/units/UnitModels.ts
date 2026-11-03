/**
 * UnitModels — the low-poly model catalogue for every unit and structure.
 *
 * All models are procedural (no asset downloads, no licensing questions,
 * tiny memory) and built once per renderer. Team-coloured parts (hull
 * stripes, roofs, flags, missile bands) take the owner's palette colour per
 * instance.
 */

import type { BufferGeometry } from "three";
import { ModelBuilder } from "./ModelBuilder";

export type ModelKind =
  | "warship"
  | "destroyer"
  | "battleship"
  | "submarine"
  | "carrier"
  | "transport"
  | "tradeShip"
  | "trainEngine"
  | "goldMine"
  | "market"
  | "oilRig"
  | "airbase"
  | "radarStation"
  | "bomber"
  | "fighter"
  | "expressEngine"
  | "armoredTrain"
  | "troopTrain"
  | "railSam"
  | "trainCarriage"
  | "trainCarriageLoaded"
  | "atomBomb"
  | "hydrogenBomb"
  | "mirv"
  | "mirvWarhead"
  | "samMissile"
  | "shell"
  | "artilleryShell"
  | "rocket"
  | "city"
  | "port"
  | "factory"
  | "defensePost"
  | "samLauncher"
  | "missileSilo";

const STEEL = 0x6b7680;
const DARK_STEEL = 0x3c444c;
const WHITE = 0xe8ecef;
const RUST = 0x7a3b2a;
const CONCRETE = 0xa8a49b;
const GLASS = 0x2c4a63;
const BLACK = 0x1c1f22;
const BRASS = 0xd8b04a;

const PI = Math.PI;

const builders: Record<ModelKind, () => BufferGeometry> = {
  warship: () =>
    new ModelBuilder()
      .hull(3.2, 0.8, 0.32, { color: STEEL })
      .box(2.6, 0.06, 0.62, { color: DARK_STEEL, pos: [-0.1, 0.28, 0] })
      .box(0.7, 0.32, 0.46, { color: STEEL, pos: [-0.2, 0.3, 0] })
      .box(0.42, 0.22, 0.36, { team: true, pos: [-0.25, 0.62, 0] })
      .cylinder(0.03, 0.03, 0.55, 5, {
        color: DARK_STEEL,
        pos: [-0.3, 0.84, 0],
      })
      // fore and aft turrets with barrels
      .cylinder(0.17, 0.19, 0.12, 8, { color: DARK_STEEL, pos: [0.75, 0.3, 0] })
      .box(0.5, 0.05, 0.05, { color: BLACK, pos: [1.0, 0.36, 0.05] })
      .box(0.5, 0.05, 0.05, { color: BLACK, pos: [1.0, 0.36, -0.05] })
      .cylinder(0.17, 0.19, 0.12, 8, { color: DARK_STEEL, pos: [-1.0, 0.3, 0] })
      .box(0.5, 0.05, 0.05, { color: BLACK, pos: [-1.25, 0.36, 0.05] })
      .box(0.5, 0.05, 0.05, { color: BLACK, pos: [-1.25, 0.36, -0.05] })
      .box(3.0, 0.05, 0.82, { team: true, pos: [-0.05, 0.02, 0] })
      .build(),

  // Long, narrow and low: one gun forward, torpedo tubes, raked funnel.
  destroyer: () =>
    new ModelBuilder()
      .hull(3.0, 0.55, 0.26, { color: 0x7d8790 })
      .box(2.4, 0.05, 0.42, { color: DARK_STEEL, pos: [-0.1, 0.22, 0] })
      .box(0.55, 0.26, 0.34, { color: 0x7d8790, pos: [0.15, 0.27, 0] })
      .box(0.3, 0.14, 0.28, { team: true, pos: [0.15, 0.47, 0] })
      .cylinder(0.025, 0.025, 0.45, 5, {
        color: DARK_STEEL,
        pos: [0.1, 0.7, 0],
      })
      .cylinder(0.08, 0.1, 0.3, 6, {
        color: BLACK,
        pos: [-0.35, 0.38, 0],
        rot: [0, 0, 0.25],
      })
      .cylinder(0.12, 0.13, 0.09, 8, {
        color: DARK_STEEL,
        pos: [0.85, 0.26, 0],
      })
      .box(0.42, 0.04, 0.04, { color: BLACK, pos: [1.08, 0.3, 0] })
      .box(0.5, 0.07, 0.07, { color: DARK_STEEL, pos: [-0.8, 0.27, 0.1] })
      .box(0.5, 0.07, 0.07, { color: DARK_STEEL, pos: [-0.8, 0.27, -0.1] })
      .box(2.8, 0.04, 0.58, { team: true, pos: [-0.05, 0.02, 0] })
      .build(),

  // Big and wide: tall superstructure, three triple-gun turrets.
  battleship: () => {
    const b = new ModelBuilder()
      .hull(4.2, 1.05, 0.4, { color: 0x5f6870 })
      .box(3.5, 0.07, 0.86, { color: DARK_STEEL, pos: [-0.1, 0.36, 0] })
      .box(1.1, 0.42, 0.62, { color: 0x5f6870, pos: [-0.15, 0.48, 0] })
      .box(0.6, 0.38, 0.48, { color: 0x5f6870, pos: [-0.1, 0.86, 0] })
      .box(0.36, 0.22, 0.4, { team: true, pos: [-0.05, 1.15, 0] })
      .cylinder(0.035, 0.035, 0.7, 5, {
        color: DARK_STEEL,
        pos: [-0.1, 1.55, 0],
      })
      .cylinder(0.11, 0.13, 0.36, 7, { color: BLACK, pos: [-0.55, 0.85, 0] })
      .box(4.0, 0.06, 1.08, { team: true, pos: [-0.05, 0.02, 0] });
    for (const [x, dir, y] of [
      [1.05, 1, 0.42],
      [0.62, 1, 0.56],
      [-1.25, -1, 0.42],
    ] as const) {
      b.cylinder(0.24, 0.27, 0.16, 10, { color: DARK_STEEL, pos: [x, y, 0] });
      for (const z of [-0.09, 0, 0.09]) {
        b.box(0.62, 0.05, 0.05, {
          color: BLACK,
          pos: [x + dir * 0.36, y + 0.06, z],
        });
      }
    }
    return b.build();
  },

  // Low, dark hull mostly under water, conning tower with a team band.
  submarine: () =>
    new ModelBuilder()
      .cylinder(0.22, 0.18, 2.4, 10, {
        color: 0x2b3036,
        pos: [0, -0.08, 0],
        rot: [0, 0, PI / 2],
      })
      .box(0.5, 0.36, 0.22, { color: 0x2b3036, pos: [0.15, 0.08, 0] })
      .box(0.52, 0.07, 0.24, { team: true, pos: [0.15, 0.4, 0] })
      .cylinder(0.02, 0.02, 0.35, 4, {
        color: DARK_STEEL,
        pos: [0.25, 0.45, 0],
      })
      .box(0.25, 0.04, 0.5, { color: 0x2b3036, pos: [-1.05, -0.02, 0] })
      .build(),

  // Long flat deck with an island on the starboard side.
  carrier: () =>
    new ModelBuilder()
      .hull(4.4, 1.0, 0.42, { color: 0x5f6870 })
      .box(4.6, 0.08, 1.3, { color: 0x3d3f33, pos: [0, 0.4, 0] })
      .box(4.2, 0.02, 0.05, { color: WHITE, pos: [0, 0.44, 0] })
      .box(0.9, 0.55, 0.28, { color: 0x5f6870, pos: [0.3, 0.44, -0.52] })
      .box(0.92, 0.1, 0.3, { team: true, pos: [0.3, 0.99, -0.52] })
      .cylinder(0.03, 0.03, 0.5, 4, {
        color: DARK_STEEL,
        pos: [0.3, 1.09, -0.52],
      })
      .box(4.4, 0.05, 1.0, { team: true, pos: [0, 0.02, 0] })
      .build(),

  transport: () =>
    new ModelBuilder()
      .hull(2.4, 0.95, 0.3, { color: 0x5d6b5a })
      .box(1.5, 0.28, 0.7, { team: true, pos: [-0.15, 0.26, 0] })
      .box(0.4, 0.34, 0.6, { color: WHITE, pos: [-0.85, 0.26, 0] })
      .box(0.32, 0.08, 0.5, { color: GLASS, pos: [-0.85, 0.5, 0] })
      .build(),

  tradeShip: () =>
    new ModelBuilder()
      .hull(2.8, 0.85, 0.3, { color: RUST })
      .box(0.45, 0.24, 0.62, { color: 0xc0392b, pos: [0.6, 0.26, 0] })
      .box(0.45, 0.24, 0.62, { color: 0x2e86c1, pos: [0.12, 0.26, 0] })
      .box(0.45, 0.24, 0.62, { color: 0xd4ac0d, pos: [-0.36, 0.26, 0] })
      .box(0.45, 0.2, 0.62, { color: 0x27ae60, pos: [0.36, 0.5, 0] })
      .box(0.42, 0.5, 0.6, { color: WHITE, pos: [-0.95, 0.26, 0] })
      .box(0.12, 0.25, 0.12, { team: true, pos: [-1.05, 0.76, 0] })
      .build(),

  trainEngine: () =>
    new ModelBuilder()
      .box(1.3, 0.12, 0.5, { color: BLACK, pos: [0, 0.08, 0] })
      .cylinder(0.24, 0.24, 0.9, 10, {
        team: true,
        pos: [0.65, 0.42, 0],
        rot: [0, 0, PI / 2],
      })
      .box(0.42, 0.5, 0.5, { team: true, pos: [-0.42, 0.2, 0] })
      .box(0.44, 0.06, 0.54, { color: DARK_STEEL, pos: [-0.42, 0.7, 0] })
      .cylinder(0.07, 0.09, 0.3, 6, { color: BLACK, pos: [0.5, 0.6, 0] })
      .cylinder(0.12, 0.12, 0.56, 8, {
        color: DARK_STEEL,
        pos: [0.35, 0.12, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.12, 0.12, 0.56, 8, {
        color: DARK_STEEL,
        pos: [-0.35, 0.12, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .build(),

  // Streamlined, low and long: nose cone, team stripe, silver body.
  expressEngine: () =>
    new ModelBuilder()
      .box(1.5, 0.1, 0.5, { color: BLACK, pos: [0, 0.08, 0] })
      .box(1.0, 0.42, 0.5, { color: 0xc9ced3, pos: [-0.2, 0.34, 0] })
      .cylinder(0.21, 0.25, 0.5, 10, {
        color: 0xc9ced3,
        pos: [0.52, 0.32, 0],
        rot: [0, 0, -PI / 2],
      })
      .box(1.42, 0.07, 0.52, { team: true, pos: [0.05, 0.3, 0] })
      .box(0.3, 0.12, 0.46, { color: GLASS, pos: [0.38, 0.48, 0] })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [0.45, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [-0.45, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .build(),

  // Riveted armour box with a gun turret.
  armoredTrain: () =>
    new ModelBuilder()
      .box(1.5, 0.12, 0.56, { color: BLACK, pos: [0, 0.08, 0] })
      .box(1.4, 0.4, 0.58, { color: 0x4b5a3c, pos: [0, 0.34, 0] })
      .box(1.42, 0.06, 0.6, { team: true, pos: [0, 0.2, 0] })
      .cylinder(0.2, 0.24, 0.16, 10, { color: 0x3c4830, pos: [0.15, 0.62, 0] })
      .box(0.62, 0.06, 0.06, { color: BLACK, pos: [0.5, 0.66, 0] })
      .box(0.3, 0.16, 0.4, { color: 0x3c4830, pos: [-0.45, 0.6, 0] })
      .cylinder(0.12, 0.12, 0.6, 8, {
        color: DARK_STEEL,
        pos: [0.45, 0.12, -0.3],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.12, 0.12, 0.6, 8, {
        color: DARK_STEEL,
        pos: [-0.45, 0.12, -0.3],
        rot: [PI / 2, 0, 0],
      })
      .build(),

  // Passenger-style coach in team colour with a row of windows.
  troopTrain: () => {
    const b = new ModelBuilder()
      .box(1.4, 0.1, 0.5, { color: BLACK, pos: [0, 0.08, 0] })
      .box(1.3, 0.42, 0.5, { team: true, pos: [0, 0.34, 0] })
      .box(1.34, 0.06, 0.54, { color: 0x5d6b5a, pos: [0, 0.58, 0] });
    for (const x of [-0.45, -0.15, 0.15, 0.45]) {
      b.box(0.18, 0.12, 0.52, { color: GLASS, pos: [x, 0.42, 0] });
    }
    return b
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [0.42, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [-0.42, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .build();
  },

  // Flatcar carrying a tilted twin missile launcher.
  railSam: () =>
    new ModelBuilder()
      .box(1.4, 0.12, 0.54, { color: BLACK, pos: [0, 0.08, 0] })
      .box(1.36, 0.08, 0.56, { team: true, pos: [0, 0.18, 0] })
      .box(0.5, 0.2, 0.4, { color: STEEL, pos: [-0.1, 0.32, 0] })
      .cylinder(0.06, 0.06, 0.8, 8, {
        color: WHITE,
        pos: [0.15, 0.62, 0.1],
        rot: [0, 0, -1.0],
      })
      .cylinder(0.06, 0.06, 0.8, 8, {
        color: WHITE,
        pos: [0.15, 0.62, -0.1],
        rot: [0, 0, -1.0],
      })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [0.42, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [-0.42, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .build(),

  trainCarriage: () =>
    new ModelBuilder()
      .box(1.2, 0.1, 0.5, { color: BLACK, pos: [0, 0.08, 0] })
      .box(1.1, 0.06, 0.52, { team: true, pos: [0, 0.18, 0] })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [0.35, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [-0.35, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .build(),

  trainCarriageLoaded: () =>
    new ModelBuilder()
      .box(1.2, 0.1, 0.5, { color: BLACK, pos: [0, 0.08, 0] })
      .box(1.1, 0.06, 0.52, { team: true, pos: [0, 0.18, 0] })
      .box(0.48, 0.3, 0.44, { color: 0x8d6e4a, pos: [0.27, 0.24, 0] })
      .box(0.48, 0.3, 0.44, { color: 0x7b5d3c, pos: [-0.27, 0.24, 0] })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [0.35, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .cylinder(0.11, 0.11, 0.56, 8, {
        color: DARK_STEEL,
        pos: [-0.35, 0.11, -0.28],
        rot: [PI / 2, 0, 0],
      })
      .build(),

  // Missiles point along +X; origin at their centre (they fly in the air).
  atomBomb: () => missile(1.6, 0.16, WHITE),
  hydrogenBomb: () => missile(2.2, 0.22, 0xd9d4c5),
  mirv: () => missile(2.8, 0.28, 0x3a3f45),
  mirvWarhead: () =>
    new ModelBuilder()
      .cone(0.13, 0.5, 6, {
        color: DARK_STEEL,
        rot: [0, 0, -PI / 2],
        pos: [0.25, 0, 0],
      })
      .cylinder(0.13, 0.13, 0.12, 6, {
        team: true,
        rot: [0, 0, PI / 2],
        pos: [0.06, 0, 0],
      })
      .build(),
  samMissile: () =>
    new ModelBuilder()
      .cylinder(0.05, 0.05, 0.8, 6, {
        color: WHITE,
        rot: [0, 0, PI / 2],
        pos: [0.4, 0, 0],
      })
      .cone(0.05, 0.18, 6, {
        team: true,
        rot: [0, 0, -PI / 2],
        pos: [0.8, 0, 0],
      })
      .build(),
  shell: () =>
    new ModelBuilder()
      .cylinder(0.06, 0.06, 0.45, 5, {
        color: 0xffd36b,
        rot: [0, 0, PI / 2],
        pos: [0.22, 0, 0],
      })
      .build(),

  artilleryShell: () =>
    new ModelBuilder()
      .cylinder(0.12, 0.12, 0.5, 8, {
        color: BRASS,
        rot: [0, 0, -PI / 2],
        pos: [-0.25, 0, 0],
      })
      .cone(0.12, 0.3, 8, {
        color: 0x6b5b3a,
        rot: [0, 0, -PI / 2],
        pos: [0.25, 0, 0],
      })
      .cylinder(0.125, 0.125, 0.08, 8, {
        team: true,
        rot: [0, 0, -PI / 2],
        pos: [-0.05, 0, 0],
      })
      .build(),
  rocket: () => missile(1.3, 0.12, 0xc9ced3),

  // Structures: origin at ground level, centred on their tile.
  // Downtown block: glass tower, offices and brick houses on a plaza.
  // Facades get windows (lit at night); roofs take the owner colour.
  city: () =>
    new ModelBuilder()
      .box(2.4, 0.08, 2.4, { color: 0x9a978f })
      .box(0.62, 2.4, 0.62, {
        color: 0x8fa4b4,
        pattern: "windows",
        pos: [-0.45, 0.08, -0.45],
      })
      .box(0.66, 0.1, 0.66, { team: true, pos: [-0.45, 2.48, -0.45] })
      .box(0.2, 0.18, 0.2, { color: DARK_STEEL, pos: [-0.45, 2.58, -0.45] })
      .box(0.75, 1.5, 0.7, {
        color: 0xd6cfc0,
        pattern: "windows",
        pos: [0.5, 0.08, -0.5],
      })
      .box(0.79, 0.1, 0.74, { team: true, pos: [0.5, 1.58, -0.5] })
      .box(0.9, 0.9, 0.62, {
        color: 0xc8bfae,
        pattern: "windows",
        pos: [0.42, 0.08, 0.55],
      })
      .box(0.94, 0.1, 0.66, { team: true, pos: [0.42, 0.98, 0.55] })
      .box(0.42, 0.36, 0.42, {
        color: 0xb5654a,
        pattern: "brick",
        pos: [-0.55, 0.08, 0.35],
      })
      .cone(0.34, 0.3, 4, {
        team: true,
        pos: [-0.55, 0.44, 0.35],
        rot: [0, PI / 4, 0],
      })
      .box(0.42, 0.36, 0.42, {
        color: 0xa9705a,
        pattern: "brick",
        pos: [-0.55, 0.08, 0.88],
      })
      .cone(0.34, 0.3, 4, {
        team: true,
        pos: [-0.55, 0.44, 0.88],
        rot: [0, PI / 4, 0],
      })
      .sphere(0.17, { color: 0x3f6b35, pos: [0.05, 0.25, 0.05] })
      .sphere(0.14, { color: 0x4a7a3c, pos: [-0.05, 0.22, 1.0] })
      .build(),

  port: () =>
    new ModelBuilder()
      .box(2.6, 0.18, 1.0, { color: CONCRETE, pos: [0, 0, -0.5] })
      .box(0.5, 0.14, 1.6, { color: 0x7d6b55, pos: [0.6, 0, 0.6] })
      .box(0.5, 0.14, 1.6, { color: 0x7d6b55, pos: [-0.6, 0, 0.6] })
      .box(0.9, 0.6, 0.7, {
        color: 0x8d8579,
        pattern: "panels",
        pos: [-0.6, 0.18, -0.55],
      })
      .box(0.94, 0.08, 0.74, { team: true, pos: [-0.6, 0.78, -0.55] })
      // crane
      .box(0.16, 1.6, 0.16, { color: BRASS, pos: [0.6, 0.18, -0.5] })
      .box(1.3, 0.12, 0.12, { color: BRASS, pos: [0.85, 1.7, -0.5] })
      .box(0.04, 0.6, 0.04, { color: BLACK, pos: [1.35, 1.1, -0.5] })
      .build(),

  factory: () =>
    new ModelBuilder()
      .box(2.0, 0.08, 1.8, { color: CONCRETE })
      .box(1.6, 0.8, 1.2, {
        color: 0x8c5a4a,
        pattern: "brick",
        pos: [0, 0.08, 0],
      })
      .box(1.62, 0.12, 1.22, {
        team: true,
        pattern: "panels",
        pos: [0, 0.88, 0],
      })
      .cylinder(0.14, 0.18, 1.6, 8, {
        color: 0x6e4a3d,
        pos: [0.55, 0.08, -0.35],
      })
      .cylinder(0.14, 0.18, 1.3, 8, {
        color: 0x6e4a3d,
        pos: [0.15, 0.08, -0.35],
      })
      .box(0.6, 0.5, 0.5, {
        color: 0xb9b2a3,
        pattern: "windows",
        pos: [-0.7, 0.08, 0.5],
      })
      .build(),

  // Mine shaft: a tall steel headframe with the hoist wheel on top, the
  // winding-engine house, an ore heap and a cart on its track. Reads as a
  // vertical landmark on a mountainside.
  goldMine: () => {
    const b = new ModelBuilder()
      .cylinder(0.95, 1.1, 0.18, 8, { color: 0x6b6458 })
      // Four tapering legs of the headframe.
      .box(0.08, 2.2, 0.08, {
        color: 0x4b5157,
        pos: [-0.32, 0.18, -0.32],
        rot: [0.08, 0, -0.08],
      })
      .box(0.08, 2.2, 0.08, {
        color: 0x4b5157,
        pos: [0.32, 0.18, -0.32],
        rot: [0.08, 0, 0.08],
      })
      .box(0.08, 2.2, 0.08, {
        color: 0x4b5157,
        pos: [-0.32, 0.18, 0.32],
        rot: [-0.08, 0, -0.08],
      })
      .box(0.08, 2.2, 0.08, {
        color: 0x4b5157,
        pos: [0.32, 0.18, 0.32],
        rot: [-0.08, 0, 0.08],
      })
      // Cross bracing.
      .box(0.62, 0.05, 0.05, { color: 0x5d646b, pos: [0, 0.9, -0.3] })
      .box(0.62, 0.05, 0.05, { color: 0x5d646b, pos: [0, 0.9, 0.3] })
      .box(0.05, 0.05, 0.62, { color: 0x5d646b, pos: [-0.3, 0.9, 0] })
      .box(0.05, 0.05, 0.62, { color: 0x5d646b, pos: [0.3, 0.9, 0] })
      .box(0.5, 0.05, 0.05, { color: 0x5d646b, pos: [0, 1.6, -0.24] })
      .box(0.5, 0.05, 0.05, { color: 0x5d646b, pos: [0, 1.6, 0.24] })
      // Platform and hoist wheel (team coloured hub).
      .box(0.56, 0.08, 0.56, { color: 0x3c444c, pos: [0, 2.3, 0] })
      .cylinder(0.32, 0.32, 0.06, 14, {
        color: 0x2a2f34,
        pos: [0, 2.68, 0.0],
        rot: [Math.PI / 2, 0, 0],
      })
      .cylinder(0.1, 0.1, 0.1, 8, {
        team: true,
        pos: [0, 2.68, -0.02],
        rot: [Math.PI / 2, 0, 0],
      })
      // Winding-engine house with a team roof.
      .box(0.62, 0.55, 0.5, {
        color: 0x8a5a44,
        pattern: "brick",
        pos: [0.62, 0.18, 0.55],
      })
      .box(0.66, 0.08, 0.54, { team: true, pos: [0.62, 0.73, 0.55] })
      .cylinder(0.06, 0.08, 0.6, 6, {
        color: 0x2a2f34,
        pos: [0.82, 0.73, 0.68],
      })
      // Ore heap glinting gold, and a cart on rails.
      .cone(0.38, 0.34, 7, { color: BRASS, pos: [-0.62, 0.18, 0.55] })
      .box(0.9, 0.03, 0.12, { color: 0x3c3226, pos: [-0.1, 0.18, -0.75] })
      .box(0.28, 0.16, 0.18, { color: 0x5a4030, pos: [-0.3, 0.21, -0.75] })
      .cone(0.12, 0.08, 6, { color: BRASS, pos: [-0.3, 0.37, -0.75] });
    return b.build();
  },

  // Market hall with team-coloured awning and stalls.
  market: () =>
    new ModelBuilder()
      .box(1.8, 0.08, 1.4, { color: CONCRETE })
      .box(1.4, 0.55, 0.9, {
        color: 0xc9b48a,
        pattern: "brick",
        pos: [0, 0.08, -0.1],
      })
      .box(1.5, 0.1, 1.0, { team: true, pos: [0, 0.63, -0.1] })
      .box(0.36, 0.25, 0.3, { color: 0xc0392b, pos: [-0.5, 0.08, 0.5] })
      .box(0.36, 0.25, 0.3, { color: 0x27ae60, pos: [0, 0.08, 0.5] })
      .box(0.36, 0.25, 0.3, { color: 0xd4ac0d, pos: [0.5, 0.08, 0.5] })
      .build(),

  // Offshore platform on legs with a derrick.
  oilRig: () =>
    new ModelBuilder()
      .cylinder(0.08, 0.08, 0.9, 5, {
        color: DARK_STEEL,
        pos: [0.55, -0.4, 0.55],
      })
      .cylinder(0.08, 0.08, 0.9, 5, {
        color: DARK_STEEL,
        pos: [-0.55, -0.4, 0.55],
      })
      .cylinder(0.08, 0.08, 0.9, 5, {
        color: DARK_STEEL,
        pos: [0.55, -0.4, -0.55],
      })
      .cylinder(0.08, 0.08, 0.9, 5, {
        color: DARK_STEEL,
        pos: [-0.55, -0.4, -0.55],
      })
      .box(1.5, 0.15, 1.5, { color: STEEL, pos: [0, 0.5, 0] })
      .box(1.52, 0.06, 1.52, { team: true, pos: [0, 0.65, 0] })
      .cone(0.32, 1.4, 4, { color: 0xb8b2a2, pos: [0.3, 0.7, 0.2] })
      .box(0.5, 0.35, 0.4, {
        color: WHITE,
        pattern: "windows",
        pos: [-0.4, 0.7, -0.35],
      })
      .cylinder(0.05, 0.05, 0.5, 5, { color: RUST, pos: [-0.55, 1.05, 0.5] })
      .build(),

  // Runway, hangar and control tower.
  airbase: () =>
    new ModelBuilder()
      .box(2.6, 0.06, 0.55, { color: 0x3d3f33 })
      .box(2.4, 0.07, 0.06, { color: WHITE, pos: [0, 0.0, 0] })
      .box(0.9, 0.45, 0.7, {
        color: 0x6f7a5a,
        pattern: "panels",
        pos: [-0.6, 0.06, 0.75],
      })
      .box(0.92, 0.08, 0.72, { team: true, pos: [-0.6, 0.51, 0.75] })
      .cylinder(0.12, 0.14, 0.8, 6, { color: CONCRETE, pos: [0.8, 0.06, 0.75] })
      .box(0.3, 0.2, 0.3, { color: GLASS, pos: [0.8, 0.86, 0.75] })
      .build(),

  // Radar: equipment hut, lattice mast and a tilted dish.
  radarStation: () =>
    new ModelBuilder()
      .box(1.6, 0.08, 1.6, { color: CONCRETE })
      .box(0.7, 0.45, 0.55, {
        color: 0x7d8a72,
        pattern: "panels",
        pos: [-0.35, 0.08, 0.35],
      })
      .box(0.74, 0.07, 0.59, { team: true, pos: [-0.35, 0.53, 0.35] })
      .cylinder(0.08, 0.14, 1.4, 4, { color: STEEL, pos: [0.3, 0.08, -0.25] })
      .cylinder(0.55, 0.12, 0.18, 10, {
        color: WHITE,
        pos: [0.3, 1.45, -0.25],
        rot: [0.55, 0, 0.3],
      })
      .cylinder(0.02, 0.02, 0.4, 4, {
        color: DARK_STEEL,
        pos: [0.36, 1.55, -0.2],
        rot: [0.55, 0, 0.3],
      })
      .sphere(0.06, { team: true, pos: [0.3, 1.5, -0.25] })
      .build(),

  // Twin-engine bomber (nose along +x).
  bomber: () =>
    new ModelBuilder()
      .cylinder(0.11, 0.08, 1.4, 6, { color: 0x5f6b4a, rot: [0, 0, PI / 2] })
      .box(0.35, 0.03, 1.8, { color: 0x5f6b4a })
      .box(0.25, 0.03, 0.7, { color: 0x5f6b4a, pos: [-0.62, 0.05, 0] })
      .box(0.22, 0.25, 0.03, { team: true, pos: [-0.65, 0.12, 0] })
      .cylinder(0.07, 0.07, 0.3, 6, {
        color: BLACK,
        pos: [0.1, -0.05, 0.45],
        rot: [0, 0, PI / 2],
      })
      .cylinder(0.07, 0.07, 0.3, 6, {
        color: BLACK,
        pos: [0.1, -0.05, -0.45],
        rot: [0, 0, PI / 2],
      })
      .box(0.16, 0.08, 0.1, { color: GLASS, pos: [0.6, 0.06, 0] })
      .build(),

  // Small single-seat fighter.
  fighter: () =>
    new ModelBuilder()
      .cylinder(0.07, 0.05, 0.9, 6, { color: 0x8a8f86, rot: [0, 0, PI / 2] })
      .box(0.22, 0.02, 1.0, { color: 0x8a8f86 })
      .box(0.15, 0.02, 0.4, { color: 0x8a8f86, pos: [-0.38, 0.03, 0] })
      .box(0.14, 0.14, 0.02, { team: true, pos: [-0.4, 0.08, 0] })
      .box(0.12, 0.06, 0.08, { color: GLASS, pos: [0.1, 0.06, 0] })
      .build(),

  defensePost: () =>
    new ModelBuilder()
      .cylinder(0.85, 1.0, 0.5, 8, { color: 0x7f7a6b })
      .cylinder(0.87, 0.87, 0.12, 8, { team: true, pos: [0, 0.5, 0] })
      .box(0.6, 0.1, 0.12, { color: BLACK, pos: [0.85, 0.32, 0] })
      .box(0.6, 0.1, 0.12, { color: BLACK, pos: [-0.85, 0.32, 0] })
      .box(0.12, 0.1, 0.6, { color: BLACK, pos: [0, 0.32, 0.85] })
      .build(),

  samLauncher: () =>
    new ModelBuilder()
      .cylinder(0.9, 1.0, 0.2, 10, { color: CONCRETE })
      .cylinder(0.45, 0.5, 0.3, 8, { team: true, pos: [0, 0.2, 0] })
      .cylinder(0.09, 0.09, 1.1, 6, {
        color: WHITE,
        pos: [0.15, 0.5, 0.15],
        rot: [0.5, 0, -0.5],
      })
      .cylinder(0.09, 0.09, 1.1, 6, {
        color: WHITE,
        pos: [0.15, 0.5, -0.15],
        rot: [-0.5, 0, -0.5],
      })
      .cylinder(0.09, 0.09, 1.1, 6, {
        color: WHITE,
        pos: [-0.15, 0.5, 0.15],
        rot: [0.5, 0, 0.5],
      })
      .cylinder(0.09, 0.09, 1.1, 6, {
        color: WHITE,
        pos: [-0.15, 0.5, -0.15],
        rot: [-0.5, 0, 0.5],
      })
      .build(),

  missileSilo: () =>
    new ModelBuilder()
      .cylinder(1.0, 1.1, 0.25, 12, { color: CONCRETE })
      .cylinder(0.75, 0.75, 0.06, 12, { team: true, pos: [0, 0.25, 0] })
      .cylinder(0.55, 0.6, 0.12, 12, { color: DARK_STEEL, pos: [0, 0.3, 0] })
      .box(0.08, 0.04, 1.1, { color: 0xe0b02a, pos: [0, 0.42, 0] })
      .build(),
};

function missile(length: number, radius: number, body: number): BufferGeometry {
  const bodyLen = length * 0.7;
  return new ModelBuilder()
    .cylinder(radius, radius, bodyLen, 8, {
      color: body,
      rot: [0, 0, -PI / 2],
      pos: [-length / 2, 0, 0],
    })
    .cylinder(radius * 1.02, radius * 1.02, length * 0.08, 8, {
      team: true,
      rot: [0, 0, -PI / 2],
      pos: [-length * 0.1, 0, 0],
    })
    .cone(radius, length * 0.3, 8, {
      color: body,
      rot: [0, 0, -PI / 2],
      pos: [-length / 2 + bodyLen, 0, 0],
    })
    .box(length * 0.18, radius * 3.2, 0.04, {
      color: DARK_STEEL,
      pos: [-length * 0.42, -radius * 1.6, 0],
    })
    .box(length * 0.18, 0.04, radius * 3.2, {
      color: DARK_STEEL,
      pos: [-length * 0.42, 0, 0],
    })
    .build();
}

const cache = new Map<ModelKind, BufferGeometry>();

/** The shared geometry for a model kind (built on first use). */
export function modelGeometry(kind: ModelKind): BufferGeometry {
  let g = cache.get(kind);
  if (g === undefined) {
    g = builders[kind]();
    cache.set(kind, g);
  }
  return g;
}

export const ALL_MODEL_KINDS = Object.keys(builders) as ModelKind[];

export function disposeModelCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
