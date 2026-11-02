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

import { MeshStandardMaterial, Vector2, type Texture } from "three";
import {
  TERRITORY_FUNCTIONS_GLSL,
  TERRITORY_UNIFORMS_GLSL,
} from "../territory/TerritoryShader";

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
float tFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * tNoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec3 terrainAlbedo(vec3 wp, float up) {
  float h = wp.y;
  float n = tFbm(wp.xz * 0.11);
  float n2 = tNoise(wp.xz * 1.7);
  vec3 seabed = vec3(0.32, 0.30, 0.22);
  vec3 sand = vec3(0.76, 0.70, 0.50);
  vec3 grass = mix(vec3(0.24, 0.42, 0.16), vec3(0.36, 0.50, 0.20), n);
  vec3 dry = mix(vec3(0.46, 0.46, 0.26), vec3(0.52, 0.44, 0.30), n);
  vec3 rock = mix(vec3(0.38, 0.35, 0.32), vec3(0.50, 0.47, 0.43), n2);
  vec3 snow = vec3(0.93, 0.94, 0.97);

  vec3 c = seabed;
  c = mix(c, sand, smoothstep(-0.25, 0.05, h));
  c = mix(c, grass, smoothstep(0.22, 0.45, h + (n - 0.5) * 0.15));
  c = mix(c, dry, smoothstep(1.3, 2.4, h + (n - 0.5) * 0.6));
  c = mix(c, rock, smoothstep(3.0, 4.2, h + (n - 0.5) * 0.8));
  // Steep faces are rock regardless of altitude.
  c = mix(c, rock, smoothstep(0.86, 0.72, up) * step(0.2, h));
  c = mix(c, snow, smoothstep(6.6, 7.6, h + (n - 0.5) * 1.2) * smoothstep(0.6, 0.8, up));
  // Authored in sRGB; convert to linear for lighting.
  return pow(c * (0.9 + 0.2 * n2), vec3(2.2));
}
`;

export interface TerrainMaterialUniforms {
  uOwnerTex: { value: Texture };
  uPaletteTex: { value: Texture };
  uRailTex: { value: Texture };
  uMapSize: { value: Vector2 };
  uTime: { value: number };
  uFillStrength: { value: number };
  uBorderWidth: { value: number };
  uHighlightOwner: { value: number };
}

export function createTerrainMaterial(
  ownerTex: Texture,
  paletteTex: Texture,
  railTex: Texture,
  mapWidth: number,
  mapHeight: number,
): { material: MeshStandardMaterial; uniforms: TerrainMaterialUniforms } {
  const uniforms: TerrainMaterialUniforms = {
    uOwnerTex: { value: ownerTex },
    uPaletteTex: { value: paletteTex },
    uRailTex: { value: railTex },
    uMapSize: { value: new Vector2(mapWidth, mapHeight) },
    uTime: { value: 0 },
    uFillStrength: { value: 0.75 },
    uBorderWidth: { value: 0.22 },
    uHighlightOwner: { value: -1 },
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
        "#include <color_fragment>\ndiffuseColor.rgb = applyTerritory(terrainAlbedo(vTerrainWorld, vTerrainUp), vTerrainWorld.xz);",
      );
  };
  material.customProgramCacheKey = () => "laukolaroser-terrain-v2";
  return { material, uniforms };
}
