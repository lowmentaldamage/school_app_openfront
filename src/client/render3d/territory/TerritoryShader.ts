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
uniform float uHoverStrength;
uniform float uBorderWidth;
uniform float uHighlightOwner;
uniform float uCaptureNow;
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

// Fill strength: the player's tint setting, full colour when hovered.
float territoryStrength(int owner) {
  if (owner == 0) return 0.0;
  return abs(float(owner) - uHighlightOwner) < 0.5
    ? max(uFillStrength, uHoverStrength)
    : uFillStrength;
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

  // Light tint so the terrain stays visible; the hovered country shows in
  // full colour (uHighlightOwner).
  vec4 c00 = territoryFill(o00);
  vec4 c10 = territoryFill(o10);
  vec4 c01 = territoryFill(o01);
  vec4 c11 = territoryFill(o11);
  float k00 = c00.a * territoryStrength(o00) * w00;
  float k10 = c10.a * territoryStrength(o10) * w10;
  float k01 = c01.a * territoryStrength(o01) * w01;
  float k11 = c11.a * territoryStrength(o11) * w11;
  // Weight colours by their own tint (squared) so a lightly tinted
  // neighbour doesn't wash out a highlighted one; normalise by the same
  // weights so a uniform area has a uniform colour (no per-tile dots).
  float kk = k00 * k00 + k10 * k10 + k01 * k01 + k11 * k11;
  vec3 rgbSum = c00.rgb * k00 * k00 + c10.rgb * k10 * k10
              + c01.rgb * k01 * k01 + c11.rgb * k11 * k11;
  float aSum = k00 + k10 + k01 + k11;
  vec3 fillRgb = kk > 0.0 ? rgbSum / kk : albedo;
  // Colourise rather than paint over: the country's hue at the terrain's
  // own brightness, so grass, rock and snow keep their detail and the
  // tint reads clearly even when light. Full strength paints the colour.
  // Brightness follows the terrain gently (mountains darker, snow
  // lighter) without amplifying ground grain.
  float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
  float fillLum = max(dot(fillRgb, vec3(0.299, 0.587, 0.114)), 0.03);
  vec3 tinted = clamp(fillRgb / fillLum * mix(0.2, lum, 0.55), 0.0, 1.0);
  float a = clamp(aSum, 0.0, 1.0);
  vec3 color = mix(albedo, mix(tinted, fillRgb, a * a), clamp(a * 2.2, 0.0, 1.0));

  ivec2 tile = ivec2(floor(tilePos));
  vec4 ownTexel = texelFetch(uOwnerTex, clamp(tile, ivec2(0), ivec2(uMapSize) - 1), 0);

  // Conquest: a freshly taken tile fades in from bare ground with a bright
  // flash of the new owner's colour (stamp in the low bits of B and A,
  // see OwnerBuffer).
  int capStamp = ((int(ownTexel.b * 255.0 + 0.5) & 127) << 7)
               | (int(ownTexel.a * 255.0 + 0.5) & 127);
  if (capStamp != 0) {
    float age = mod(uCaptureNow - float(capStamp), 16383.0) * 0.05;
    if (age < 0.9) {
      float k = smoothstep(0.0, 0.9, age);
      color = mix(albedo, color, 0.2 + 0.8 * k);
      int capOwner = territoryOwnerAt(tile);
      vec3 glow = capOwner != 0
        ? territoryBorderColor(capOwner) * 1.6 + vec3(0.25)
        : vec3(0.02);
      color = mix(color, glow, (1.0 - k) * (1.0 - k) * 0.75);
    }
  }

  // Nuclear fallout: scorched, sickly ground (owner texture B bit 7).
  float fallout = ownTexel.b;
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
    // Tiles per screen pixel: borders keep a minimum on-screen width, so
    // they stay visible when zoomed out instead of thinning to nothing.
    float tpp = length(fwidth(tilePos));
    float width = clamp(max(uBorderWidth, tpp * 3.0), 0.0, 0.5);
    // same == 1 deep inside, ~0.5 on the boundary.
    float edge = 1.0 - smoothstep(0.5, 0.5 + width, same);
    // Zoomed far out a tile is smaller than a pixel: look further for a
    // different owner so the border is still drawn a couple of pixels wide.
    if (tpp > 0.35) {
      float d = min(tpp * 2.0, 10.0);
      if (territoryOwnerAt(ivec2(floor(tilePos + vec2(d, 0.0)))) != self ||
          territoryOwnerAt(ivec2(floor(tilePos - vec2(d, 0.0)))) != self ||
          territoryOwnerAt(ivec2(floor(tilePos + vec2(0.0, d)))) != self ||
          territoryOwnerAt(ivec2(floor(tilePos - vec2(0.0, d)))) != self) {
        edge = 1.0;
      }
    }
    if (edge > 0.0) {
      float pulse = 0.9 + 0.1 * sin(uTime * 2.4 + (tilePos.x + tilePos.y) * 0.08);
      float hi = abs(float(self) - uHighlightOwner) < 0.5 ? 1.35 : 1.0;
      vec3 bc = territoryBorderColor(self) * pulse * hi;
      color = mix(color, bc, edge);
      // Dark outline on the outer part of the band, for contrast on any
      // terrain (snow, sand, pale player colours).
      float outer = 1.0 - smoothstep(0.5, 0.5 + width * 0.4, same);
      color = mix(color, color * 0.25, outer * 0.85);
    }
  }
  return color;
}
`;
