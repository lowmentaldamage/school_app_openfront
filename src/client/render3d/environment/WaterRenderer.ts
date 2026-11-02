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
  };

  constructor(hf: Heightfield) {
    this.depthTex = buildDepthTexture(hf);
    this.uniforms = {
      uTime: { value: 0 },
      uDepthTex: { value: this.depthTex },
      uMapSize: { value: new Vector2(hf.width, hf.height) },
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
float waterDepth01() {
  vec2 uv = vWaterWorld.xz / uMapSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  return texture2D(uDepthTex, uv).r;
}
vec2 waveGrad(vec2 p, float t) {
  // Four non-aligned octaves so the glints never form a visible lattice.
  vec2 g = vec2(0.0);
  g += vec2(cos(dot(p, vec2(0.71, 0.33)) + t * 1.1), cos(dot(p, vec2(-0.27, 0.64)) - t * 0.9)) * 0.022;
  g += vec2(cos(dot(p, vec2(1.37, -0.91)) - t * 1.7), cos(dot(p, vec2(0.83, 1.29)) + t * 1.4)) * 0.012;
  g += vec2(cos(dot(p, vec2(2.9, 1.7)) + t * 2.3), cos(dot(p, vec2(-1.9, 2.6)) - t * 2.1)) * 0.006;
  g += vec2(cos(dot(p, vec2(-4.3, -3.1)) - t * 2.9), cos(dot(p, vec2(3.7, -4.6)) + t * 2.6)) * 0.003;
  return g;
}`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
float wDepth = waterDepth01();
vec3 shallow = pow(vec3(0.20, 0.58, 0.62), vec3(2.2));
vec3 deep = pow(vec3(0.03, 0.14, 0.30), vec3(2.2));
diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 0.85, wDepth));
float foam = (1.0 - smoothstep(0.02, 0.10, wDepth))
           * (0.6 + 0.4 * sin(uTime * 1.6 + (vWaterWorld.x + vWaterWorld.z) * 1.3));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), clamp(foam, 0.0, 1.0) * 0.55);
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
  vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
        );
    };
    material.customProgramCacheKey = () => "laukolaroser-water-v1";

    this.mesh = new Mesh(geom, material);
    this.mesh.name = "water";
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
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
