/**
 * WaterRenderer — a single sea-level plane covering the map (plus a margin
 * that fades into the fog), shaded with:
 *   - depth-based colour (shallow turquoise → deep blue) from a depth
 *     texture derived from the Heightfield,
 *   - animated normals from two scrolling wave octaves for specular glints,
 *   - shoreline foam where the water is shallow.
 *
 * Built on MeshStandardMaterial (onBeforeCompile) so it shares the scene's
 * lights, shadows and fog.
 */

import {
  DataTexture,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RedFormat,
  UnsignedByteType,
  Vector2,
  ClampToEdgeWrapping,
} from "three";
import type { Texture } from "three";
import type { Heightfield } from "../terrain/Heightfield";

/** Depth (in tiles) mapped to the full 0..1 range of the depth texture. */
const MAX_DEPTH = 3.5;

export function buildDepthTexture(
  hf: Heightfield,
  maxSide = 2048,
): DataTexture {
  const scale = Math.max(1, Math.ceil(Math.max(hf.width, hf.height) / maxSide));
  const w = Math.ceil(hf.width / scale);
  const h = Math.ceil(hf.height / scale);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const depth = -hf.sample((x + 0.5) * scale, (y + 0.5) * scale);
      data[y * w + x] = Math.round(
        Math.max(0, Math.min(1, depth / MAX_DEPTH)) * 255,
      );
    }
  }
  const tex = new DataTexture(data, w, h, RedFormat, UnsignedByteType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export class WaterRenderer {
  readonly mesh: Mesh;
  private readonly depthTex: DataTexture;
  private readonly uniforms: {
    uTime: { value: number };
    uDepthTex: { value: DataTexture };
    uMapSize: { value: Vector2 };
    uTerrainDetail: { value: Texture };
  };

  /**
   * `hf` should be the lightly smoothed detail heightfield and `detailTex`
   * the TerrainDetail texture, so the shoreline follows the tiles exactly.
   */
  constructor(hf: Heightfield, detailTex: Texture) {
    this.depthTex = buildDepthTexture(hf);
    this.uniforms = {
      uTime: { value: 0 },
      uDepthTex: { value: this.depthTex },
      uMapSize: { value: new Vector2(hf.width, hf.height) },
      uTerrainDetail: { value: detailTex },
    };
    // Wide enough that the plane's edge always sits inside the horizon fog.
    const margin = Math.max(hf.width, hf.height) * 4;
    const geom = new PlaneGeometry(
      hf.width + margin * 2,
      hf.height + margin * 2,
    );
    geom.rotateX(-Math.PI / 2);
    geom.translate(hf.width / 2, 0, hf.height / 2);

    const material = new MeshStandardMaterial({
      color: 0x1d4f73,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity: 0.9,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vWaterWorld;",
        )
        .replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
varying vec3 vWaterWorld;
uniform float uTime;
uniform sampler2D uDepthTex;
uniform vec2 uMapSize;
uniform sampler2D uTerrainDetail;
float waterLand() {
  vec2 uv = vWaterWorld.xz / uMapSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture2D(uTerrainDetail, uv).g;
}
float waterDepth01() {
  vec2 uv = vWaterWorld.xz / uMapSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return texture2D(uDepthTex, uv).r;
}
const mat2 W_ROT = mat2(0.80, -0.60, 0.60, 0.80);
float wHash(vec2 q) {
  q = fract(q * vec2(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}
float wNoise(vec2 q) {
  vec2 i = floor(q);
  vec2 f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x),
             mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y);
}
vec2 waveGrad(vec2 p, float t) {
  // Four non-aligned octaves so the glints never form a visible lattice.
  vec2 g = vec2(0.0);
  g += vec2(cos(dot(p, vec2(0.71, 0.33)) + t * 1.1), cos(dot(p, vec2(-0.27, 0.64)) - t * 0.9)) * 0.034;
  g += vec2(cos(dot(p, vec2(1.37, -0.91)) - t * 1.7), cos(dot(p, vec2(0.83, 1.29)) + t * 1.4)) * 0.012;
  g += vec2(cos(dot(p, vec2(2.9, 1.7)) + t * 2.3), cos(dot(p, vec2(-1.9, 2.6)) - t * 2.1)) * 0.006;
  g += vec2(cos(dot(p, vec2(-4.3, -3.1)) - t * 2.9), cos(dot(p, vec2(3.7, -4.6)) + t * 2.6)) * 0.003;
  return g;
}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
// Crisp shoreline: the water stops exactly at the tile coastline (the 0.5
// contour of the filtered land mask), not where the coarse mesh dips.
float wLand = waterLand();
if (wLand > 0.5) discard;
float wDepth = waterDepth01();
vec3 shallow = pow(vec3(0.20, 0.58, 0.62), vec3(2.2));
vec3 deep = pow(vec3(0.03, 0.14, 0.30), vec3(2.2));
diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 0.85, wDepth));
float foam = max(1.0 - smoothstep(0.02, 0.10, wDepth), smoothstep(0.3, 0.5, wLand))
           * (0.6 + 0.4 * sin(uTime * 1.6 + (vWaterWorld.x + vWaterWorld.z) * 1.3));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), clamp(foam, 0.0, 1.0) * 0.55);
// Rolling swell (visible from far away) and travelling whitecaps out at sea.
{
  vec2 p = vWaterWorld.xz;
  float swell = sin(dot(p, vec2(0.11, 0.07)) - uTime * 0.9)
              * sin(dot(p, vec2(-0.05, 0.13)) - uTime * 0.6);
  diffuseColor.rgb *= 1.0 + 0.14 * swell * smoothstep(0.1, 0.6, wDepth);
  // Whitecaps from drifting value noise (rotated off the grid), so they
  // scatter like real foam instead of peaking on a regular lattice.
  float capN = wNoise(W_ROT * p * 0.55 + vec2(uTime * 0.35, -uTime * 0.2)) * 0.6
             + wNoise(W_ROT * W_ROT * p * 1.3 - vec2(uTime * 0.5, uTime * 0.15)) * 0.4;
  float capFade = 1.0 - smoothstep(0.12, 0.45, length(fwidth(p)));
  float cap = smoothstep(0.72, 0.86, capN) * smoothstep(0.35, 1.0, wDepth) * capFade;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93), cap * 0.4);
}
diffuseColor.a = mix(0.55, 0.94, smoothstep(0.0, 0.5, wDepth));`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
{
  // Fade wave normals with screen-space footprint: once a wave is smaller
  // than a pixel it only produces sparkle/moire, so flatten it.
  float footprint = length(fwidth(vWaterWorld.xz));
  vec2 g = waveGrad(vWaterWorld.xz, uTime) * (1.0 - smoothstep(0.15, 0.8, footprint));
  // Long swell: low frequency, so it stays visible (and alias-free) zoomed out.
  vec2 sp = vWaterWorld.xz;
  // Faded with distance: on glossy water a regular swell far away
  // reads as stripes in the sky reflection.
  g += vec2(cos(dot(sp, vec2(0.11, 0.07)) - uTime * 0.9) * 0.11,
            cos(dot(sp, vec2(-0.05, 0.13)) - uTime * 0.6) * 0.13) * 0.06
       * (1.0 - smoothstep(0.4, 2.5, footprint));
  vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
        );
    };
    material.customProgramCacheKey = () => "laukolaroser-water-v6";

    this.mesh = new Mesh(geom, material);
    this.mesh.name = "water";
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  /**
   * Sky reflections: with a reflection map the water turns glossy (sky and
   * sun mirrored, stronger at grazing angles); null: matte as before.
   */
  setEnvMap(tex: Texture | null): void {
    const m = this.mesh.material as MeshStandardMaterial;
    const had = m.envMap !== null;
    m.envMap = tex;
    m.envMapIntensity = 1.0;
    m.roughness = tex === null ? 0.55 : 0.16;
    if (had !== (tex !== null)) m.needsUpdate = true;
  }

  update(timeSeconds: number): void {
    this.uniforms.uTime.value = timeSeconds;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.depthTex.dispose();
  }
}
