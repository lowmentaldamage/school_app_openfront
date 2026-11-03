/**
 * ModelBuilder — assembles low-poly models from primitives into a single
 * non-indexed BufferGeometry with:
 *   - `color`    per-vertex base colour (linear),
 *   - `teamMask` 1 where the part takes the owner's team colour, else 0.
 *   - `pattern`  procedural surface detail drawn by the unit shader:
 *                0 plain, 1 windows (lit at night), 2 metal panels, 3 brick.
 *
 * One merged geometry per model means one InstancedMesh (one draw call) per
 * model kind, however many ships or buildings are on the map.
 *
 * Model space: +X is forward (heading), +Y is up, origin at the waterline /
 * ground contact point. 1 unit = 1 map tile.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface PartOptions {
  /** sRGB hex colour; ignored where team = true (still used as fallback). */
  color?: number;
  team?: boolean;
  /** Procedural surface detail (see the unit shader). */
  pattern?: Pattern;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
}

export type Pattern = "windows" | "panels" | "brick";

const PATTERN_IDS: Record<Pattern, number> = {
  windows: 1,
  panels: 2,
  brick: 3,
};

const tmpColor = new Color();

export class ModelBuilder {
  private readonly parts: BufferGeometry[] = [];

  box(w: number, h: number, d: number, o: PartOptions = {}): this {
    // Boxes sit on their base so pos.y is the bottom.
    const g = new BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, o);
  }

  cylinder(
    rTop: number,
    rBottom: number,
    h: number,
    segments: number,
    o: PartOptions = {},
  ): this {
    const g = new CylinderGeometry(rTop, rBottom, h, segments);
    g.translate(0, h / 2, 0);
    return this.add(g, o);
  }

  cone(r: number, h: number, segments: number, o: PartOptions = {}): this {
    const g = new ConeGeometry(r, h, segments);
    g.translate(0, h / 2, 0);
    return this.add(g, o);
  }

  sphere(r: number, o: PartOptions = {}): this {
    return this.add(new SphereGeometry(r, 8, 6), o);
  }

  /**
   * A ship hull: pointed bow at +X, flat stern, extruded across Z and
   * tapering towards the keel.
   */
  hull(length: number, beam: number, depth: number, o: PartOptions = {}): this {
    const half = length / 2;
    const s = new Shape();
    s.moveTo(-half, -beam / 2);
    s.lineTo(half * 0.55, -beam / 2);
    s.quadraticCurveTo(half * 0.95, -beam * 0.3, half, 0);
    s.quadraticCurveTo(half * 0.95, beam * 0.3, half * 0.55, beam / 2);
    s.lineTo(-half, beam / 2);
    s.lineTo(-half, -beam / 2);
    const g = new ExtrudeGeometry(s, {
      depth,
      bevelEnabled: true,
      bevelThickness: depth * 0.35,
      bevelSize: beam * 0.12,
      bevelSegments: 1,
      curveSegments: 4,
    });
    // Shape is in XY, extruded along +Z: lay it flat so depth goes up (+Y).
    g.rotateX(-Math.PI / 2);
    g.translate(0, -depth * 0.35, 0);
    return this.add(g, o);
  }

  build(): BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (merged === null) throw new Error("ModelBuilder: merge failed");
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  add(geom: BufferGeometry, o: PartOptions): this {
    const g = geom.index ? geom.toNonIndexed() : geom;
    if (g !== geom) geom.dispose();
    g.deleteAttribute("uv");
    const m = new Matrix4().compose(
      new Vector3(...(o.pos ?? [0, 0, 0])),
      new Quaternion().setFromEuler(new Euler(...(o.rot ?? [0, 0, 0]))),
      new Vector3(...(o.scale ?? [1, 1, 1])),
    );
    g.applyMatrix4(m);
    const n = g.getAttribute("position").count;
    const colors = new Float32Array(n * 3);
    const mask = new Float32Array(n);
    const pattern = new Float32Array(n);
    pattern.fill(o.pattern ? PATTERN_IDS[o.pattern] : 0);
    tmpColor.setHex(o.color ?? 0xffffff); // hex is sRGB → stored linear
    for (let i = 0; i < n; i++) {
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
      mask[i] = o.team ? 1 : 0;
    }
    g.setAttribute("color", new BufferAttribute(colors, 3));
    g.setAttribute("teamMask", new BufferAttribute(mask, 1));
    g.setAttribute("pattern", new BufferAttribute(pattern, 1));
    this.parts.push(g);
    return this;
  }
}
