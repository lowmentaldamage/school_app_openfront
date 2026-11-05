/**
 * TerrainMaterial — a MeshStandardMaterial extended (onBeforeCompile) with
 * procedural terrain albedo and the territory overlay.
 *
 * Extending the standard material keeps three.js lighting, shadows and fog
 * intact; we only replace the diffuse colour. Albedo is derived per
 * fragment from world height and slope (sand → grass → dry highland →
 * rock → snow) with value noise for variation, so no texture assets are
 * required and nothing tiles visibly at any zoom.
 */

import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RGFormat,
  Vector2,
  type Texture,
} from "three";
import {
  TERRITORY_FUNCTIONS_GLSL,
  TERRITORY_UNIFORMS_GLSL,
} from "../territory/TerritoryShader";
import type { TerrainDetailData } from "./TerrainDetail";

const TERRAIN_ALBEDO_GLSL = /* glsl */ `
float tHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x),
             mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}
// Each octave is rotated and offset so the value-noise lattice never
// lines up with the tile grid (no regular dots or cross-hatching).
const mat2 T_ROT = mat2(0.80, -0.60, 0.60, 0.80);
float tFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  p = T_ROT * p + vec2(3.7, 1.3);
  for (int i = 0; i < 4; i++) {
    v += a * tNoise(p);
    p = T_ROT * p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
uniform sampler2D uTerrainDetail;
// Tiles per detail texel (1 at native resolution, 0.5 when upscaled).
uniform float uDetailStep;
// Full-resolution tile data: r = height, g = land mask (see TerrainDetail.ts).
vec2 terrainDetailAt(vec2 p) {
  return texture2D(uTerrainDetail, p / uMapSize).rg;
}
// Layer (0 ground - 100 mountain tops) of a land height: the inverse of
// Heightfield.levelHeight(). Keep the two in step.
float terrainLevel(float h) {
  if (h < 1.5) return max(0.0, (h - 0.3) / 0.036);
  if (h < 9.0) return 33.3333 + (h - 1.5) / 0.225;
  return 66.6667 + (h - 9.0) / 1.53;
}
float terrainLevelHeight(float L) {
  if (L < 33.3333) return 0.3 + L * 0.036;
  if (L < 66.6667) return 1.5 + (L - 33.3333) * 0.225;
  return 9.0 + (L - 66.6667) * 1.53;
}
// Height snapped to its layer: flat treads with a short riser between
// layers, so the land reads as clean stacked layers. Water is unchanged.
// Layers follow a smoothed height (a coarser mip, ~2 tiles) so each step
// is a clean band instead of tracing the fine relief noise.
float terrainSmoothHeight(vec2 p) {
  return textureLod(uTerrainDetail, p / uMapSize, 2.0).r;
}
float terrainTerraced(vec2 p) {
  float h = terrainSmoothHeight(p);
  if (h <= 0.3) return h;
  float L = terrainLevel(h);
  float f = fract(L);
  return terrainLevelHeight(floor(L) + smoothstep(0.35, 0.65, f));
}
// Per-pixel normal from the tile heights (central differences, 1 tile),
// so relief is lit at tile resolution whatever the mesh density. The caller
// fades it to the mesh normal once a tile is smaller than a pixel.
// True (unexaggerated) slope: 1 on flat ground, used for rock-on-cliffs.
float terrainSlopeUp(vec3 wp) {
  float hl = terrainDetailAt(wp.xz - vec2(uDetailStep, 0.0)).r;
  float hr = terrainDetailAt(wp.xz + vec2(uDetailStep, 0.0)).r;
  float hd = terrainDetailAt(wp.xz - vec2(0.0, uDetailStep)).r;
  float hu = terrainDetailAt(wp.xz + vec2(0.0, uDetailStep)).r;
  return normalize(vec3(hl - hr, 2.0 * uDetailStep, hd - hu)).y;
}
vec3 terrainDetailNormal(vec3 wp) {
  // One-tile steps: the terraced field has no detail finer than that.
  float hl = terrainTerraced(wp.xz - vec2(1.0, 0.0));
  float hr = terrainTerraced(wp.xz + vec2(1.0, 0.0));
  float hd = terrainTerraced(wp.xz - vec2(0.0, 1.0));
  float hu = terrainTerraced(wp.xz + vec2(0.0, 1.0));
  // Shading relief is exaggerated: game heights are low, and real
  // landscapes read through their light and shadow.
  vec3 n = vec3((hl - hr) * 1.5, 2.0, (hd - hu) * 1.5);
  // Gentle micro relief on land (rocky ground, folds), mostly in the
  // hills and mountains; flat ground stays smooth (no tile-sized grain).
  float land = terrainDetailAt(wp.xz).g;
  float foot = length(fwidth(wp.xz));
  float micro = land * (1.0 - smoothstep(0.05, 0.25, foot));
  if (micro > 0.0) {
    vec2 q = wp.xz * 0.43;
    float e = 0.2;
    float c0 = tFbm(q);
    float gx = tFbm(q + vec2(e, 0.0)) - c0;
    float gz = tFbm(q + vec2(0.0, e)) - c0;
    float steep = 0.08 + 0.92 * smoothstep(40.0, 75.0, terrainLevel(terrainDetailAt(wp.xz).r));
    n.xz -= vec2(gx, gz) / e * 0.08 * steep * micro;
  }
  return normalize(n);
}
uniform float uCloudCover;
// 0..1 shadow of drifting clouds at a ground point (big soft shapes).
float cloudShadow(vec2 p) {
  if (uCloudCover <= 0.0) return 0.0;
  vec2 q = p * 0.0065 + vec2(uTime * 0.012, uTime * 0.005);
  float n = tFbm(q) * 0.7 + tNoise(q * 2.3 + 7.0) * 0.3;
  return smoothstep(0.62 - 0.22 * uCloudCover, 0.8 - 0.2 * uCloudCover, n)
       * min(1.0, uCloudCover * 1.6);
}
vec3 terrainAlbedo(vec3 wp, float up) {
  vec2 td = terrainDetailAt(wp.xz);
  float h = td.r;
  float land = td.g;
  float n = tFbm(wp.xz * 0.08);
  float n2 = tFbm(wp.xz * 0.55 + 17.0);
  float grain = tNoise(T_ROT * wp.xz * 1.3 + 5.1);
  vec3 seabed = vec3(0.30, 0.31, 0.24);
  vec3 sand = mix(vec3(0.78, 0.72, 0.52), vec3(0.70, 0.64, 0.46), n2);
  vec3 grass = mix(vec3(0.22, 0.40, 0.14), vec3(0.38, 0.52, 0.21), n);
  grass = mix(grass, vec3(0.30, 0.44, 0.17), n2 * 0.5);
  // Highland meadow: olive green, browner where the noise is high.
  vec3 dry = mix(vec3(0.34, 0.42, 0.20), vec3(0.50, 0.46, 0.30), n);
  vec3 rock = mix(vec3(0.36, 0.34, 0.31), vec3(0.52, 0.49, 0.45), n2);
  vec3 snow = vec3(0.93, 0.94, 0.97);

  vec3 c = seabed;
  c = mix(c, sand, smoothstep(-0.6, -0.05, h));
  c = mix(c, grass, smoothstep(0.24, 0.42, h + (n - 0.5) * 0.15));
  // Colour bands follow the layers: grass below 33, meadow to 66, rock
  // above, snow on the top layers.
  float L = terrainLevel(max(h, 0.3));
  float Ls = terrainLevel(max(terrainSmoothHeight(wp.xz), 0.3));
  c = mix(c, dry, smoothstep(30.0, 40.0, L + (n - 0.5) * 8.0));
  c = mix(c, rock, smoothstep(64.0, 72.0, L + (n - 0.5) * 8.0));
  // Steep faces are rock regardless of altitude.
  c = mix(c, rock, smoothstep(0.86, 0.70, up) * step(0.2, h));
  // Snow: patchy on the high peaks and ridges, never a flat white sheet;
  // steep faces stay rock.
  float patches = smoothstep(0.38, 0.62, tFbm(wp.xz * 0.22 + 31.0));
  float snowLine = smoothstep(86.0, 93.0, L + (n - 0.5) * 6.0);
  c = mix(c, snow, snowLine * mix(0.35, 1.0, patches) * smoothstep(0.5, 0.8, up));
  // Beach: a thin sand rim exactly along the tile coastline.
  float beach = smoothstep(0.5, 0.56, land) * (1.0 - smoothstep(0.62, 0.8, land));
  c = mix(c, sand, beach * (1.0 - smoothstep(0.8, 1.6, h)));
  // Contour lines every 10 layers (stronger every 50) on hills and
  // mountains (plains stay plain), a pixel or so wide
  // at any zoom; dropped where they would crowd together.
  float fw = max(fwidth(Ls), 1e-4);
  float d10 = abs(Ls - floor(Ls / 10.0 + 0.5) * 10.0) / fw;
  float d50 = abs(Ls - floor(Ls / 50.0 + 0.5) * 50.0) / fw;
  float crowd = 1.0 - smoothstep(1.2, 3.0, fw);
  float contour = (1.0 - smoothstep(0.4, 1.3, d10)) * 0.1
                + (1.0 - smoothstep(0.6, 1.8, d50)) * 0.12;
  c *= 1.0 - contour * crowd * step(0.3, h) * smoothstep(28.0, 34.0, Ls);
  // Water tiles (by the tile mask, not the mesh height) read as shallow
  // water even where the coarse mesh pokes above the water plane.
  vec3 shallowWater = mix(vec3(0.22, 0.52, 0.55), seabed, 0.25);
  c = mix(shallowWater, c, smoothstep(0.46, 0.52, land));
  // Cloud shadows drifting across the land (more under cloudy skies).
  c *= 1.0 - cloudShadow(wp.xz) * 0.32;
  // Authored in sRGB; convert to linear for lighting.
  // Fine grain only where it is larger than a pixel (no distant sparkle).
  float grainAmt = 1.0 - smoothstep(0.15, 0.6, length(fwidth(wp.xz)));
  return pow(c * (1.0 + (grain - 0.5) * 0.05 * grainAmt), vec3(2.2));
}
`;

export interface TerrainMaterialUniforms {
  uTerrainDetail: { value: Texture };
  uDetailStep: { value: number };
  uOwnerTex: { value: Texture };
  uPaletteTex: { value: Texture };
  uRailTex: { value: Texture };
  uMapSize: { value: Vector2 };
  uTime: { value: number };
  uFillStrength: { value: number };
  uHoverStrength: { value: number };
  uBorderWidth: { value: number };
  uHighlightOwner: { value: number };
  /** Current capture stamp (OwnerBuffer.captureStamp, fractional). */
  uCaptureNow: { value: number };
  /** 0..1 cloud cover for drifting cloud shadows (0: none). */
  uCloudCover: { value: number };
}

export function createTerrainMaterial(
  ownerTex: Texture,
  paletteTex: Texture,
  railTex: Texture,
  detailTex: Texture,
  detailScale: number,
  mapWidth: number,
  mapHeight: number,
): { material: MeshStandardMaterial; uniforms: TerrainMaterialUniforms } {
  const uniforms: TerrainMaterialUniforms = {
    uTerrainDetail: { value: detailTex },
    uDetailStep: { value: 1 / detailScale },
    uOwnerTex: { value: ownerTex },
    uPaletteTex: { value: paletteTex },
    uRailTex: { value: railTex },
    uMapSize: { value: new Vector2(mapWidth, mapHeight) },
    uTime: { value: 0 },
    // Light country tint (Settings → Graphics → Country colour); the
    // hovered country shows at uHoverStrength.
    uFillStrength: { value: 0.25 },
    uHoverStrength: { value: 0.8 },
    uBorderWidth: { value: 0.42 },
    uHighlightOwner: { value: -1 },
    uCaptureNow: { value: 0 },
    uCloudCover: { value: 0 },
  };

  const material = new MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vTerrainWorld;\nvarying float vTerrainUp;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainUp = objectNormal.y;",
      );
    const detailNormal = "vec3 terrainN = terrainDetailNormal(vTerrainWorld);";
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying vec3 vTerrainWorld;",
          "varying float vTerrainUp;",
          TERRITORY_UNIFORMS_GLSL,
          TERRAIN_ALBEDO_GLSL,
          TERRITORY_FUNCTIONS_GLSL,
        ].join("\n"),
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
${detailNormal}
diffuseColor.rgb = applyTerritory(terrainAlbedo(vTerrainWorld, min(vTerrainUp, terrainSlopeUp(vTerrainWorld))), vTerrainWorld.xz);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
float terrainFoot = smoothstep(6.0, 16.0, length(fwidth(vTerrainWorld.xz)));
normal = normalize(mix((viewMatrix * vec4(terrainN, 0.0)).xyz, normal, terrainFoot));`,
      );
  };
  material.customProgramCacheKey = () => "laukolaroser-terrain-v15";
  return { material, uniforms };
}

/** Uploads TerrainDetail data as a mipmapped, linearly filtered RG16F texture. */
export function createTerrainDetailTexture(d: TerrainDetailData): DataTexture {
  const half = new Uint16Array(d.values.length);
  for (let i = 0; i < half.length; i++) {
    half[i] = DataUtils.toHalfFloat(d.values[i]);
  }
  const tex = new DataTexture(half, d.width, d.height, RGFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
