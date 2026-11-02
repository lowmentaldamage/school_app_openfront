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
  | "transport"
  | "tradeShip"
  | "trainEngine"
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
  city: () =>
    new ModelBuilder()
      .box(2.4, 0.08, 2.4, { color: CONCRETE })
      .box(0.7, 1.6, 0.7, { color: 0xcfc8b8, pos: [-0.5, 0.08, -0.45] })
      .box(0.72, 0.1, 0.72, { team: true, pos: [-0.5, 1.68, -0.45] })
      .box(0.6, 1.0, 0.8, { color: 0xb8b0a0, pos: [0.55, 0.08, -0.5] })
      .box(0.62, 0.1, 0.82, { team: true, pos: [0.55, 1.08, -0.5] })
      .box(0.9, 0.7, 0.6, { color: 0xd8d2c4, pos: [0.4, 0.08, 0.55] })
      .box(0.92, 0.08, 0.62, { team: true, pos: [0.4, 0.78, 0.55] })
      .box(0.5, 2.3, 0.5, { color: 0x9fb1bf, pos: [-0.45, 0.08, 0.6] })
      .box(0.52, 0.1, 0.52, { team: true, pos: [-0.45, 2.38, 0.6] })
      .build(),

  port: () =>
    new ModelBuilder()
      .box(2.6, 0.18, 1.0, { color: CONCRETE, pos: [0, 0, -0.5] })
      .box(0.5, 0.14, 1.6, { color: 0x7d6b55, pos: [0.6, 0, 0.6] })
      .box(0.5, 0.14, 1.6, { color: 0x7d6b55, pos: [-0.6, 0, 0.6] })
      .box(0.9, 0.6, 0.7, { team: true, pos: [-0.6, 0.18, -0.55] })
      // crane
      .box(0.16, 1.6, 0.16, { color: BRASS, pos: [0.6, 0.18, -0.5] })
      .box(1.3, 0.12, 0.12, { color: BRASS, pos: [0.85, 1.7, -0.5] })
      .box(0.04, 0.6, 0.04, { color: BLACK, pos: [1.35, 1.1, -0.5] })
      .build(),

  factory: () =>
    new ModelBuilder()
      .box(2.0, 0.08, 1.8, { color: CONCRETE })
      .box(1.6, 0.8, 1.2, { color: 0x8c5a4a, pos: [0, 0.08, 0] })
      .box(1.62, 0.12, 1.22, { team: true, pos: [0, 0.88, 0] })
      .cylinder(0.14, 0.18, 1.6, 8, {
        color: 0x6e4a3d,
        pos: [0.55, 0.08, -0.35],
      })
      .cylinder(0.14, 0.18, 1.3, 8, {
        color: 0x6e4a3d,
        pos: [0.15, 0.08, -0.35],
      })
      .box(0.6, 0.5, 0.5, { color: 0x9a6b5a, pos: [-0.7, 0.08, 0.5] })
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
