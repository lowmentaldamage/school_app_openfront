/**
 * GLSL for the territory overlay and animated borders, injected into the
 * terrain material (see terrain/TerrainMaterial.ts).
 *
 * Fill: the four tiles around the fragment are fetched exactly (texelFetch,
 * no filtering) and their fill colours blended bilinearly, which gives soft
 * one-tile-wide transitions without blurring ownership itself.
 *
 * Border: for the fragment's own (nearest) owner we take the bilinear weight
 * of the samples that share it. That weight crosses 0.5 exactly on the
 * boundary between two owners, so a band around 0.5 is a border line whose
 * width is independent of zoom. Borders pulse gently over time.
 */

export const TERRITORY_UNIFORMS_GLSL = /* glsl */ `
uniform sampler2D uOwnerTex;
uniform sampler2D uPaletteTex;
uniform sampler2D uRailTex;
uniform vec2 uMapSize;
uniform float uTime;
uniform float uFillStrength;
uniform float uBorderWidth;
uniform float uHighlightOwner;
`;

export const TERRITORY_FUNCTIONS_GLSL = /* glsl */ `
int territoryOwnerAt(ivec2 t) {
  t = clamp(t, ivec2(0), ivec2(uMapSize) - 1);
  vec4 o = texelFetch(uOwnerTex, t, 0);
  return int(o.r * 255.0 + 0.5) + int(o.g * 255.0 + 0.5) * 256;
}

// Palette colours are sRGB; lighting runs in linear space.
vec4 territoryFill(int owner) {
  if (owner == 0) return vec4(0.0);
  vec4 c = texelFetch(uPaletteTex, ivec2(owner, 0), 0);
  return vec4(pow(c.rgb, vec3(2.2)), c.a);
}

vec3 territoryBorderColor(int owner) {
  return pow(texelFetch(uPaletteTex, ivec2(owner, 1), 0).rgb, vec3(2.2));
}

// Applies territory fill + border on top of the lit-independent albedo.
vec3 applyTerritory(vec3 albedo, vec2 tilePos) {
  if (tilePos.x < 0.0 || tilePos.y < 0.0 || tilePos.x >= uMapSize.x || tilePos.y >= uMapSize.y) {
    return albedo;
  }
  vec2 p = tilePos - 0.5;
  ivec2 b = ivec2(floor(p));
  vec2 f = fract(p);
  int o00 = territoryOwnerAt(b);
  int o10 = territoryOwnerAt(b + ivec2(1, 0));
  int o01 = territoryOwnerAt(b + ivec2(0, 1));
  int o11 = territoryOwnerAt(b + ivec2(1, 1));
  float w00 = (1.0 - f.x) * (1.0 - f.y);
  float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y;
  float w11 = f.x * f.y;

  vec4 fill = territoryFill(o00) * w00 + territoryFill(o10) * w10
            + territoryFill(o01) * w01 + territoryFill(o11) * w11;
  vec3 color = mix(albedo, fill.rgb, clamp(fill.a * uFillStrength, 0.0, 1.0));

  ivec2 tile = ivec2(floor(tilePos));
  // Nuclear fallout: scorched, sickly ground (owner texture B channel).
  float fallout = texelFetch(uOwnerTex, clamp(tile, ivec2(0), ivec2(uMapSize) - 1), 0).b;
  if (fallout > 0.5) {
    float n = fract(sin(dot(vec2(tile), vec2(12.9898, 78.233))) * 43758.5453);
    color = mix(color, vec3(0.06, 0.09, 0.03) + vec3(0.05, 0.12, 0.0) * n, 0.7);
  }

  // Railroads: 1 vertical, 2 horizontal, 3..6 corners (TL, TR, BL, BR).
  int rail = int(texelFetch(uRailTex, clamp(tile, ivec2(0), ivec2(uMapSize) - 1), 0).r * 255.0 + 0.5);
  if (rail > 0) {
    vec2 f = fract(tilePos);
    float w = 0.16;
    bool v = abs(f.x - 0.5) < w;
    bool h = abs(f.y - 0.5) < w;
    bool top = f.y < 0.5 + w;
    bool bottom = f.y > 0.5 - w;
    bool left = f.x < 0.5 + w;
    bool right = f.x > 0.5 - w;
    bool on =
      (rail == 1 && v) || (rail == 2 && h) ||
      (rail == 3 && ((v && top) || (h && left))) ||
      (rail == 4 && ((v && top) || (h && right))) ||
      (rail == 5 && ((v && bottom) || (h && left))) ||
      (rail == 6 && ((v && bottom) || (h && right)));
    if (on) color = vec3(0.05, 0.045, 0.04);
  }

  int self = territoryOwnerAt(ivec2(floor(tilePos)));
  if (self != 0) {
    float same = (o00 == self ? w00 : 0.0) + (o10 == self ? w10 : 0.0)
               + (o01 == self ? w01 : 0.0) + (o11 == self ? w11 : 0.0);
    // same == 1 deep inside, ~0.5 on the boundary.
    float edge = 1.0 - smoothstep(0.5, 0.5 + uBorderWidth, same);
    if (edge > 0.0) {
      float pulse = 0.85 + 0.15 * sin(uTime * 2.4 + (tilePos.x + tilePos.y) * 0.08);
      float hi = abs(float(self) - uHighlightOwner) < 0.5 ? 1.35 : 1.0;
      vec3 bc = territoryBorderColor(self) * pulse * hi;
      color = mix(color, bc, edge);
    }
  }
  return color;
}
`;
