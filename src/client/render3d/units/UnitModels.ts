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
  | "fort"
  | "coastalBattery"
  | "seaMine"
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
const ASPHALT = 0x3a3d40;
const HAZARD = 0xe0b02a;
const WOOD = 0x7d5a3c;
const OLIVE = 0x5d6650;

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
  // Downtown: a glass tower, a stepped office block, an apartment slab and
  // brick houses around a street cross. Facades get windows (lit at
  // night); roofs take the owner colour.
  city: () => {
    const b = new ModelBuilder()
      .box(2.4, 0.06, 2.4, { color: 0x8f8c84 })
      .box(2.4, 0.07, 0.22, { color: ASPHALT, pos: [0, 0, 0.05] })
      .box(0.22, 0.07, 2.4, { color: ASPHALT, pos: [0.05, 0, 0] })
      // Glass tower on a podium, antenna on top.
      .box(0.72, 0.3, 0.72, {
        color: 0xb9b3a6,
        pattern: "windows",
        pos: [-0.6, 0.06, -0.6],
      })
      .box(0.52, 2.5, 0.52, {
        color: 0x8fa4b4,
        pattern: "windows",
        pos: [-0.6, 0.36, -0.6],
      })
      .box(0.56, 0.08, 0.56, { team: true, pos: [-0.6, 2.86, -0.6] })
      .cylinder(0.015, 0.02, 0.45, 4, {
        color: DARK_STEEL,
        pos: [-0.6, 2.94, -0.6],
      })
      // Stepped office block.
      .box(0.72, 1.3, 0.66, {
        color: 0xd6cfc0,
        pattern: "windows",
        pos: [0.62, 0.06, -0.6],
      })
      .box(0.76, 0.06, 0.7, { team: true, pos: [0.62, 1.36, -0.6] })
      .box(0.48, 0.42, 0.44, {
        color: 0xcfc7b6,
        pattern: "windows",
        pos: [0.62, 1.42, -0.6],
      })
      .box(0.52, 0.07, 0.48, { team: true, pos: [0.62, 1.84, -0.6] })
      // Apartment slab and a low annex.
      .box(0.8, 0.85, 0.4, {
        color: 0xc8bfae,
        pattern: "windows",
        pos: [0.62, 0.06, 0.42],
      })
      .box(0.84, 0.07, 0.44, { team: true, pos: [0.62, 0.91, 0.42] })
      .box(0.42, 0.5, 0.3, {
        color: 0xbfb6a4,
        pattern: "windows",
        pos: [0.78, 0.06, 0.9],
      })
      .box(0.46, 0.06, 0.34, { team: true, pos: [0.78, 0.56, 0.9] });
    // Brick houses with pitched roofs.
    for (const [x, z] of [
      [-0.88, 0.42],
      [-0.4, 0.42],
      [-0.88, 0.92],
    ] as const) {
      b.box(0.34, 0.3, 0.34, {
        color: 0xb5654a,
        pattern: "brick",
        pos: [x, 0.06, z],
      }).cone(0.28, 0.24, 4, {
        team: true,
        pos: [x, 0.36, z],
        rot: [0, PI / 4, 0],
      });
    }
    return b
      .sphere(0.15, { color: 0x3f6b35, pos: [-0.4, 0.22, 0.92] })
      .sphere(0.11, { color: 0x4a7a3c, pos: [-0.25, 0.18, 1.05] })
      .sphere(0.12, { color: 0x3f6b35, pos: [0.2, 0.18, 0.95] })
      .build();
  },

  // Harbour: quay with a warehouse, container stacks, a gantry crane over
  // the water, two piers and a lighthouse.
  port: () => {
    const b = new ModelBuilder()
      .box(2.6, 0.2, 1.0, { color: CONCRETE, pos: [0, 0, -0.5] })
      .box(2.6, 0.03, 0.06, { color: HAZARD, pos: [0, 0.2, -0.03] })
      .box(0.4, 0.14, 1.4, { color: WOOD, pos: [-0.75, 0, 0.7] })
      .box(0.4, 0.14, 1.4, { color: WOOD, pos: [0.75, 0, 0.7] })
      // Warehouse with a curved team roof.
      .box(1.0, 0.5, 0.6, {
        color: 0x8d8579,
        pattern: "panels",
        pos: [-0.65, 0.2, -0.6],
      })
      .arch(0.3, 1.04, 8, {
        team: true,
        pos: [-0.65, 0.7, -0.6],
        scale: [1, 0.55, 1],
      });
    // Container stacks.
    const boxes: [number, number, number, number][] = [
      [0.12, 0.2, -0.75, 0xb03a2e],
      [0.12, 0.34, -0.75, 0x2e6fb0],
      [0.12, 0.2, -0.55, 0x2f8f4e],
      [0.44, 0.2, -0.75, 0xd08a2c],
      [0.44, 0.2, -0.55, 0xb03a2e],
      [0.44, 0.34, -0.55, 0x6f7a80],
    ];
    for (const [x, y, z, c] of boxes) {
      b.box(0.3, 0.14, 0.17, { color: c, pattern: "panels", pos: [x, y, z] });
    }
    // Gantry crane reaching over the water.
    for (const z of [-0.85, -0.3]) {
      b.box(0.07, 1.3, 0.07, { color: BRASS, pos: [0.95, 0.2, z] });
    }
    for (const bollard of [-0.95, -0.55, 0.55, 0.95]) {
      b.cylinder(0.03, 0.035, 0.07, 6, {
        color: BLACK,
        pos: [bollard, 0.14, 1.35],
      });
    }
    return (
      b
        .box(0.12, 0.1, 1.5, { color: BRASS, pos: [0.95, 1.5, -0.2] })
        .box(0.18, 0.14, 0.18, { team: true, pos: [0.95, 1.36, 0.25] })
        .box(0.02, 0.6, 0.02, { color: BLACK, pos: [0.95, 0.76, 0.4] })
        // Lighthouse at the end of the west pier.
        .cylinder(0.08, 0.11, 0.6, 8, { color: WHITE, pos: [-0.75, 0.14, 1.3] })
        .cylinder(0.088, 0.095, 0.12, 8, {
          team: true,
          pos: [-0.75, 0.38, 1.3],
        })
        .cylinder(0.07, 0.07, 0.1, 8, {
          color: 0xffe9a0,
          pos: [-0.75, 0.74, 1.3],
        })
        .cone(0.1, 0.12, 8, { color: RUST, pos: [-0.75, 0.84, 1.3] })
        .build()
    );
  },

  // Works: brick hall under a row of team-coloured ridge roofs, two
  // chimneys, storage tanks and an office annex.
  factory: () => {
    const b = new ModelBuilder()
      .box(2.0, 0.06, 1.8, { color: CONCRETE })
      .box(1.5, 0.6, 1.0, {
        color: 0x8c5a4a,
        pattern: "brick",
        pos: [-0.15, 0.06, 0.1],
      });
    for (let i = 0; i < 3; i++) {
      b.cylinder(0.29, 0.29, 1.0, 3, {
        team: true,
        pattern: "panels",
        pos: [-0.65 + i * 0.5, 0.66 + 0.145, 0.6],
        rot: [-PI / 2, 0, 0],
        scale: [1, 1, 0.75],
      });
    }
    for (const [x, h] of [
      [-0.6, 1.8],
      [-0.2, 1.5],
    ] as const) {
      b.cylinder(0.1, 0.13, h, 8, { color: 0x6e4a3d, pos: [x, 0.06, -0.62] })
        .cylinder(0.105, 0.105, 0.1, 8, {
          team: true,
          pos: [x, 0.06 + h - 0.25, -0.62],
        })
        .cylinder(0.11, 0.11, 0.05, 8, {
          color: BLACK,
          pos: [x, 0.06 + h, -0.62],
        });
    }
    for (const z of [0.6, 0.15]) {
      b.cylinder(0.19, 0.19, 0.5, 10, {
        color: STEEL,
        pattern: "panels",
        pos: [0.78, 0.06, z],
      }).cone(0.19, 0.08, 10, { color: STEEL, pos: [0.78, 0.56, z] });
    }
    return b
      .box(0.5, 0.42, 0.42, {
        color: 0xb9b2a3,
        pattern: "windows",
        pos: [0.7, 0.06, -0.55],
      })
      .box(0.54, 0.06, 0.46, { team: true, pos: [0.7, 0.48, -0.55] })
      .box(0.5, 0.2, 0.3, { color: WOOD, pos: [0.15, 0.06, -0.72] })
      .build();
  },

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

  // Market square: hall with an arched team roof, a clock tower, striped
  // stalls, crates and a fountain.
  market: () => {
    const b = new ModelBuilder()
      .box(1.8, 0.06, 1.4, { color: 0xb7ae9c })
      .box(1.3, 0.4, 0.7, {
        color: 0xc9b48a,
        pattern: "brick",
        pos: [0, 0.06, -0.25],
      })
      .arch(0.36, 1.36, 10, {
        team: true,
        pos: [0, 0.46, -0.25],
        scale: [1, 0.6, 1],
      })
      .box(0.22, 0.95, 0.22, {
        color: 0xbfa77a,
        pattern: "brick",
        pos: [-0.78, 0.06, -0.48],
      })
      .box(0.24, 0.1, 0.24, { color: WHITE, pos: [-0.78, 0.8, -0.48] })
      .cone(0.18, 0.28, 4, {
        team: true,
        pos: [-0.78, 1.01, -0.48],
        rot: [0, PI / 4, 0],
      });
    const awnings = [0xc0392b, 0x27ae60, 0xd4ac0d, 0x2e6fb0];
    for (let i = 0; i < 4; i++) {
      const x = -0.6 + i * 0.36;
      b.box(0.28, 0.14, 0.18, { color: WOOD, pos: [x, 0.06, 0.42] })
        .box(0.02, 0.3, 0.02, {
          color: DARK_STEEL,
          pos: [x - 0.13, 0.06, 0.52],
        })
        .box(0.02, 0.3, 0.02, {
          color: DARK_STEEL,
          pos: [x + 0.13, 0.06, 0.52],
        })
        .box(0.32, 0.03, 0.3, {
          color: awnings[i],
          pos: [x, 0.34, 0.42],
          rot: [0.28, 0, 0],
        });
    }
    return b
      .box(0.12, 0.1, 0.12, { color: WOOD, pos: [0.66, 0.06, 0.15] })
      .box(0.1, 0.08, 0.1, { color: 0x9c7a4c, pos: [0.66, 0.16, 0.15] })
      .cylinder(0.14, 0.16, 0.08, 10, {
        color: CONCRETE,
        pos: [0.7, 0.06, 0.5],
      })
      .cylinder(0.11, 0.11, 0.02, 10, {
        color: 0x4f8fb8,
        pos: [0.7, 0.13, 0.5],
      })
      .cylinder(0.02, 0.03, 0.16, 6, { color: CONCRETE, pos: [0.7, 0.13, 0.5] })
      .build();
  },

  // Offshore platform: four legs, a two-level deck, a drilling derrick, a
  // team-coloured helipad, a crane and a flare boom.
  oilRig: () => {
    const b = new ModelBuilder();
    for (const [x, z] of [
      [0.55, 0.55],
      [-0.55, 0.55],
      [0.55, -0.55],
      [-0.55, -0.55],
    ] as const) {
      b.cylinder(0.08, 0.09, 0.95, 6, { color: HAZARD, pos: [x, -0.45, z] });
    }
    return (
      b
        .box(1.5, 0.15, 1.5, {
          color: STEEL,
          pattern: "panels",
          pos: [0, 0.5, 0],
        })
        .box(0.7, 0.25, 0.6, {
          color: WHITE,
          pattern: "windows",
          pos: [-0.38, 0.65, -0.38],
        })
        .box(0.74, 0.05, 0.64, { color: DARK_STEEL, pos: [-0.38, 0.9, -0.38] })
        .cylinder(0.27, 0.27, 0.03, 12, {
          team: true,
          pos: [-0.38, 0.95, -0.38],
        })
        .cylinder(0.12, 0.12, 0.035, 12, {
          color: WHITE,
          pos: [-0.38, 0.955, -0.38],
        })
        // Lattice derrick (four legs and braces) with a team band.
        .cylinder(0.05, 0.3, 1.5, 4, {
          color: 0xc9c2b0,
          pos: [0.35, 0.65, 0.3],
          rot: [0, PI / 4, 0],
        })
        .cylinder(0.2, 0.22, 0.1, 4, {
          team: true,
          pos: [0.35, 1.05, 0.3],
          rot: [0, PI / 4, 0],
        })
        .box(0.12, 0.12, 0.12, { color: DARK_STEEL, pos: [0.35, 2.12, 0.3] })
        // Crane.
        .cylinder(0.06, 0.07, 0.4, 6, { color: HAZARD, pos: [0.5, 0.65, -0.5] })
        .box(0.7, 0.05, 0.05, {
          color: HAZARD,
          pos: [0.5, 1.05, -0.5],
          rot: [0, 0.6, 0.35],
        })
        // Flare boom with the flame.
        .box(0.75, 0.04, 0.04, {
          color: STEEL,
          pos: [-0.75, 0.6, 0.5],
          rot: [0, 0, 2.7],
        })
        .sphere(0.09, { color: 0xff8a2a, pos: [-1.43, 0.93, 0.5] })
        .build()
    );
  },

  // Airfield: runway with markings, taxiway and apron, two arched
  // hangars with team bands, a control tower and a parked jet.
  airbase: () => {
    const b = new ModelBuilder()
      .box(2.8, 0.05, 0.5, { color: 0x3d3f33 })
      .box(0.15, 0.05, 0.45, { color: 0x4a4c40, pos: [-0.2, 0, 0.45] })
      .box(1.7, 0.05, 0.7, { color: 0x55574b, pos: [-0.25, 0, 0.98] });
    for (let i = 0; i < 6; i++) {
      b.box(0.22, 0.055, 0.035, { color: WHITE, pos: [-1.0 + i * 0.4, 0, 0] });
    }
    for (const x of [-1.3, 1.3]) {
      for (const z of [-0.15, -0.05, 0.05, 0.15]) {
        b.box(0.18, 0.056, 0.04, { color: WHITE, pos: [x, 0, z] });
      }
    }
    for (const x of [-0.85, -0.25]) {
      b.arch(0.3, 0.62, 10, {
        color: 0x6f7a5a,
        pattern: "panels",
        pos: [x, 0.05, 1.05],
        rot: [0, PI / 2, 0],
      }).arch(0.31, 0.1, 10, {
        team: true,
        pos: [x, 0.05, 1.05],
        rot: [0, PI / 2, 0],
      });
    }
    return (
      b
        .cylinder(0.09, 0.12, 0.75, 8, {
          color: CONCRETE,
          pos: [0.6, 0.05, 0.95],
        })
        .cylinder(0.17, 0.13, 0.16, 8, { color: GLASS, pos: [0.6, 0.8, 0.95] })
        .cylinder(0.19, 0.19, 0.04, 8, { team: true, pos: [0.6, 0.96, 0.95] })
        .cylinder(0.01, 0.01, 0.25, 4, {
          color: DARK_STEEL,
          pos: [0.6, 1.0, 0.95],
        })
        // Parked jet on the apron.
        .cylinder(0.04, 0.03, 0.42, 6, {
          color: 0x8a8f86,
          pos: [0.25, 0.1, 0.75],
          rot: [0, 0, -PI / 2],
        })
        .box(0.14, 0.015, 0.4, { color: 0x8a8f86, pos: [0.42, 0.09, 0.75] })
        .box(0.08, 0.1, 0.015, { team: true, pos: [0.29, 0.1, 0.75] })
        .build()
    );
  },

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

  // Star fort: low thick stone walls with corner bastions, a keep with a
  // team-coloured roof and a flag.
  fort: () => {
    const b = new ModelBuilder()
      .box(2.0, 0.08, 2.0, { color: 0x8a8577 })
      .box(1.7, 0.5, 0.22, {
        color: 0x9a9384,
        pattern: "brick",
        pos: [0, 0.08, -0.75],
      })
      .box(1.7, 0.5, 0.22, {
        color: 0x9a9384,
        pattern: "brick",
        pos: [0, 0.08, 0.75],
      })
      .box(0.22, 0.5, 1.7, {
        color: 0x9a9384,
        pattern: "brick",
        pos: [-0.75, 0.08, 0],
      })
      .box(0.22, 0.5, 1.7, {
        color: 0x9a9384,
        pattern: "brick",
        pos: [0.75, 0.08, 0],
      });
    for (const [x, z] of [
      [-0.8, -0.8],
      [0.8, -0.8],
      [-0.8, 0.8],
      [0.8, 0.8],
    ] as const) {
      b.cylinder(0.3, 0.34, 0.62, 6, {
        color: 0x8f8879,
        pattern: "brick",
        pos: [x, 0.08, z],
      }).cylinder(0.32, 0.32, 0.06, 6, { team: true, pos: [x, 0.7, z] });
    }
    return b
      .box(0.6, 0.75, 0.6, {
        color: 0x857e70,
        pattern: "brick",
        pos: [0, 0.08, 0],
      })
      .cone(0.48, 0.35, 4, {
        team: true,
        pos: [0, 0.83, 0],
        rot: [0, PI / 4, 0],
      })
      .cylinder(0.02, 0.02, 0.6, 4, { color: DARK_STEEL, pos: [0, 1.15, 0] })
      .box(0.3, 0.18, 0.02, { team: true, pos: [0.15, 1.57, 0] })
      .build();
  },

  // Shore gun: concrete emplacement, a long barrel on a turret ring.
  coastalBattery: () =>
    new ModelBuilder()
      .box(1.6, 0.3, 1.3, { color: CONCRETE, pattern: "panels" })
      .box(1.64, 0.06, 1.34, { team: true, pos: [0, 0.3, 0] })
      .cylinder(0.45, 0.5, 0.24, 10, { color: DARK_STEEL, pos: [0, 0.36, 0] })
      .box(0.5, 0.26, 0.42, { color: STEEL, pos: [0, 0.6, 0] })
      .cylinder(0.07, 0.09, 1.5, 8, {
        color: BLACK,
        pos: [0.95, 0.72, 0],
        rot: [0, 0, -PI / 2 + 0.12],
      })
      .build(),

  // Naval mine: a spiked sphere riding low in the water.
  seaMine: () => {
    const b = new ModelBuilder().sphere(0.28, {
      color: 0x2f3439,
      pos: [0, 0.05, 0],
    });
    for (const [x, y, z] of [
      [0.3, 0.05, 0],
      [-0.3, 0.05, 0],
      [0, 0.05, 0.3],
      [0, 0.05, -0.3],
      [0, 0.33, 0],
    ] as const) {
      b.box(0.06, 0.06, 0.06, { color: BRASS, pos: [x, y, z] });
    }
    return b.box(0.12, 0.05, 0.12, { team: true, pos: [0, 0.3, 0] }).build();
  },

  // Four-engine heavy bomber (nose along +x): long fuselage, glazed nose,
  // tapered wings with engines and propeller discs, twin tail fins in the
  // owner's colour.
  bomber: () => {
    const body = 0x5f6b4a;
    const b = new ModelBuilder()
      .cylinder(0.12, 0.07, 1.5, 8, {
        color: body,
        pattern: "panels",
        pos: [-0.8, 0, 0],
        rot: [0, 0, -PI / 2],
      })
      .sphere(0.12, {
        color: GLASS,
        pos: [0.7, 0.0, 0],
        scale: [1.2, 0.9, 0.9],
      })
      .box(0.32, 0.035, 2.1, {
        color: body,
        pattern: "panels",
        pos: [0.1, -0.02, 0],
      })
      .box(0.2, 0.025, 0.75, { color: body, pos: [-0.72, 0.02, 0] })
      .box(0.2, 0.26, 0.025, { team: true, pos: [-0.74, 0.03, 0.36] })
      .box(0.2, 0.26, 0.025, { team: true, pos: [-0.74, 0.03, -0.36] })
      .box(0.1, 0.04, 0.3, { team: true, pos: [0.0, 0.02, 0] });
    for (const z of [-0.75, -0.38, 0.38, 0.75]) {
      b.cylinder(0.055, 0.045, 0.32, 6, {
        color: DARK_STEEL,
        pos: [0.12, -0.04, z],
        rot: [0, 0, -PI / 2],
      }).cylinder(0.1, 0.1, 0.008, 10, {
        color: 0x4a4f54,
        pos: [0.46, -0.04, z],
        rot: [0, 0, PI / 2],
      });
    }
    return b.build();
  },

  // Single-seat fighter: slim fuselage, swept wings, bubble canopy,
  // propeller and a team-coloured tail.
  fighter: () =>
    new ModelBuilder()
      .cylinder(0.075, 0.04, 0.95, 8, {
        color: 0x8a8f86,
        pattern: "panels",
        pos: [-0.5, 0, 0],
        rot: [0, 0, -PI / 2],
      })
      .cone(0.075, 0.12, 8, {
        color: DARK_STEEL,
        pos: [0.42, 0, 0],
        rot: [0, 0, -PI / 2],
      })
      .box(0.28, 0.02, 1.05, {
        color: 0x8a8f86,
        pos: [0.02, -0.02, 0],
        rot: [0, 0.18, 0],
      })
      .box(0.14, 0.02, 0.42, { color: 0x8a8f86, pos: [-0.42, 0.02, 0] })
      .box(0.16, 0.16, 0.02, { team: true, pos: [-0.44, 0.06, 0] })
      .sphere(0.06, {
        color: GLASS,
        pos: [0.12, 0.06, 0],
        scale: [1.6, 0.8, 0.9],
      })
      .cylinder(0.09, 0.09, 0.006, 10, {
        color: 0x4a4f54,
        pos: [0.57, 0, 0],
        rot: [0, 0, PI / 2],
      })
      .build(),

  defensePost: () => {
    const b = new ModelBuilder()
      .cylinder(0.95, 1.05, 0.15, 10, { color: 0x7a7462 })
      .cylinder(0.82, 0.86, 0.2, 12, { color: 0xb5a57a, pos: [0, 0.15, 0] })
      .cylinder(0.6, 0.62, 0.06, 12, { color: 0x6b6452, pos: [0, 0.3, 0] })
      .cylinder(0.5, 0.58, 0.4, 8, {
        color: 0x8a8577,
        pattern: "panels",
        pos: [0, 0.15, 0],
      })
      .cylinder(0.56, 0.52, 0.08, 8, { team: true, pos: [0, 0.55, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2 + PI / 8;
      b.box(0.24, 0.06, 0.06, {
        color: BLACK,
        pos: [Math.cos(a) * 0.53, 0.38, Math.sin(a) * 0.53],
        rot: [0, -a, 0],
      });
    }
    return b
      .cylinder(0.2, 0.24, 0.15, 8, { color: DARK_STEEL, pos: [0, 0.63, 0] })
      .cylinder(0.035, 0.045, 0.6, 6, {
        color: BLACK,
        pos: [0.12, 0.72, 0],
        rot: [0, 0, -PI / 2 + 0.08],
      })
      .cylinder(0.012, 0.012, 0.6, 4, {
        color: DARK_STEEL,
        pos: [-0.35, 0.63, -0.25],
      })
      .box(0.24, 0.14, 0.015, { team: true, pos: [-0.23, 1.08, -0.25] })
      .build();
  },

  // Air defence: a launcher with four elevated missile tubes on a
  // turntable, a radar dish and a generator on a concrete pad.
  samLauncher: () => {
    const b = new ModelBuilder()
      .cylinder(0.9, 1.0, 0.12, 12, { color: CONCRETE })
      .cylinder(0.84, 0.86, 0.025, 12, { color: HAZARD, pos: [0, 0.12, 0] })
      .cylinder(0.76, 0.76, 0.03, 12, { color: CONCRETE, pos: [0, 0.12, 0] })
      .box(0.72, 0.18, 0.52, {
        color: OLIVE,
        pattern: "panels",
        pos: [0, 0.12, 0],
      })
      .cylinder(0.24, 0.27, 0.1, 10, { color: DARK_STEEL, pos: [0, 0.3, 0] })
      .box(0.16, 0.3, 0.42, { team: true, pos: [-0.08, 0.38, 0] });
    for (const y of [0.42, 0.58]) {
      for (const z of [-0.1, 0.1]) {
        b.cylinder(0.075, 0.075, 0.85, 8, {
          color: WHITE,
          pos: [-0.12, y, z],
          rot: [0, 0, -PI / 2 + 0.6],
        });
      }
    }
    return b
      .cylinder(0.025, 0.035, 0.6, 6, { color: STEEL, pos: [-0.55, 0.12, 0.5] })
      .cylinder(0.22, 0.05, 0.06, 10, {
        color: WHITE,
        pos: [-0.55, 0.72, 0.5],
        rot: [0.45, 0, 0.7],
      })
      .box(0.3, 0.2, 0.22, { color: OLIVE, pos: [0.5, 0.12, -0.5] })
      .box(0.32, 0.03, 0.24, { team: true, pos: [0.5, 0.32, -0.5] })
      .build();
  },

  // Nuclear silo: a round pad with hazard and team rings, split blast
  // doors, a control bunker, an antenna and a fence.
  missileSilo: () => {
    const b = new ModelBuilder()
      .cylinder(1.0, 1.1, 0.22, 14, { color: CONCRETE, pattern: "panels" })
      .cylinder(0.8, 0.8, 0.03, 14, { color: HAZARD, pos: [0, 0.22, 0] })
      .cylinder(0.72, 0.72, 0.04, 14, { team: true, pos: [0, 0.23, 0] })
      .box(0.6, 0.08, 1.1, {
        color: DARK_STEEL,
        pattern: "panels",
        pos: [-0.31, 0.25, 0],
      })
      .box(0.6, 0.08, 1.1, {
        color: DARK_STEEL,
        pattern: "panels",
        pos: [0.31, 0.25, 0],
      })
      .box(0.08, 0.12, 1.12, { color: BLACK, pos: [-0.64, 0.22, 0] })
      .box(0.08, 0.12, 1.12, { color: BLACK, pos: [0.64, 0.22, 0] })
      .box(0.42, 0.24, 0.32, {
        color: 0x9a968c,
        pattern: "panels",
        pos: [0.72, 0.0, 0.72],
        rot: [0, PI / 4, 0],
      })
      .box(0.44, 0.04, 0.34, {
        team: true,
        pos: [0.72, 0.24, 0.72],
        rot: [0, PI / 4, 0],
      })
      .cylinder(0.015, 0.025, 0.8, 4, {
        color: STEEL,
        pos: [-0.75, 0.2, -0.65],
      })
      .sphere(0.04, { color: 0xd23a2a, pos: [-0.75, 1.0, -0.65] });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * PI * 2;
      b.box(0.03, 0.16, 0.03, {
        color: DARK_STEEL,
        pos: [Math.cos(a) * 1.08, 0.0, Math.sin(a) * 1.08],
      });
    }
    return b.build();
  },
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
