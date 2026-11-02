# Laukolaroser 3D — Architecture & Progress

Laukolaroser is a 3D strategy game built by adding a new Three.js rendering
layer on top of the unchanged OpenFront-derived simulation, networking and
UI. This document records the architectural decisions and
the state of each increment.

## Origin and licensing

- Imported from the open-source game OpenFront (github.com/openfrontio/OpenFrontIO) at
  commit `103bba550d3a39ceb623179a04687719cf8a051b`.
- Code: AGPL-3.0 (see `LICENSE`, `LICENSING.md`). Open assets under
  `resources/`: CC BY-SA 4.0 (`LICENSE-ASSETS`, `CREDITS.md`). All upstream
  notices are kept intact.
- The upstream `proprietary/` directory (All Rights Reserved, licensed only
  for use within the original OpenFront game) is **not** included. The build already
  falls back to `resources/` when it is absent.
- New dependency: `three` (MIT).

## Decisions

### ADR-1: Keep the simulation, replace only the drawing

The deterministic engine (`packages/engine*`), intent/turn networking
(`src/server`, `Transport`), lobby flow and HUD are reused as-is. The 3D
renderer is a pure consumer of the same `FrameData` the 2D WebGL renderer
already receives each tick. It never imports `packages/engine` and never
writes game state, so lockstep determinism and multiplayer are untouched.

### ADR-2: The 2D camera stays authoritative; 3D supplies projection

`TransformHandler` continues to own pan/zoom/go-to/clamping. The 3D
`CameraController` maps its state (centre tile + pixels-per-tile) onto a
tilted perspective camera whose vertical span matches the 2D zoom. For
input, `TransformHandler` accepts an optional `ScreenProjector`: when the 3D
view is active every `screenToWorldCoordinates` / `worldToScreenCoordinates`
/ `screenBoundingRect` call goes through the 3D camera (ray-cast refined
against the terrain height). All existing controllers, HUD anchors, build
previews and clicks therefore work in 3D without being rewritten.

### ADR-3: Opt-in while incomplete

The 3D view is enabled with `?renderer=3d` (persisted in localStorage;
`?renderer=2d` switches back). three.js is loaded with `import()` only when
enabled, so the default bundle is unchanged. If the 3D view fails to
start, the game falls back to the 2D renderer. The 2D renderer keeps
receiving state uploads (but skips drawing) so nothing needs resyncing.

### ADR-4: Extend MeshStandardMaterial instead of raw ShaderMaterial

Terrain and water inject their colour/normal logic via `onBeforeCompile`,
which keeps three.js lighting, shadows and fog for free and lets later
increments (forests, buildings, units) share one lighting model.

### ADR-5: Territory is a texture lookup, not geometry

Ownership lives in an RGBA8 texture (one texel per tile, owner smallID in
R/G, fallout in B, defense bonus in A) sampled with `texelFetch` in the
terrain shader. Per-tick deltas update a CPU mirror (`OwnerBuffer`) and
upload only the dirty row range (`Texture.addUpdateRange`). Fill colours
are blended bilinearly from the four nearest tiles; borders are where the
fragment's own owner weight crosses 0.5, giving zoom-independent lines.
The palette is the exact `Float32Array` the 2D renderer uses, so themes,
colour-blind mode and team colours match.

## Module map (`src/client/render3d/`)

| Module                               | Role                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `WorldRenderer.ts`                   | Owns the `WebGLRenderer` and scene; composes everything below            |
| `World3DView.ts`                     | Game glue: canvas, per-tick feed, `ScreenProjector` for input            |
| `World3DFlag.ts`                     | `?renderer=3d` flag (no three.js import; safe for the homepage)          |
| `AdaptiveQuality.ts`                 | Frame-time driven quality levels (pixel ratio, shadows, shadow map size) |
| `DeviceProfile.ts`                   | Phone vs desktop budgets: start/max quality, MSAA, terrain vertex budget |
| `terrain/TerrainCodec.ts`            | Decodes `GameMap.terrainByte` bits                                       |
| `terrain/Heightfield.ts`             | Terrain bytes → smoothed elevation (land > 0 > water, guaranteed)        |
| `terrain/TerrainChunkGeometry.ts`    | Pure chunk mesh builder (shared-edge normals, crack-hiding skirts)       |
| `terrain/TerrainRenderer.ts`         | 128-tile chunks × 3 LOD levels (`THREE.LOD`), frustum culled             |
| `terrain/TerrainMaterial.ts`         | Procedural albedo (sand/grass/highland/rock/snow) + territory overlay    |
| `territory/OwnerBuffer.ts`           | CPU mirror of tile ownership with dirty-row tracking                     |
| `territory/TerritoryTextures.ts`     | Owner + palette `DataTexture`s, partial uploads                          |
| `territory/TerritoryShader.ts`       | GLSL: territory fill, animated borders, highlight                        |
| `environment/EnvironmentRenderer.ts` | Sky, fog, hemisphere + sun light, camera-fitted shadow frustum           |
| `environment/WaterRenderer.ts`       | Sea plane: depth colour, foam, anti-aliased animated wave normals        |
| `camera/CameraController.ts`         | 2D camera state → perspective camera; screen ↔ tile picking              |
| `units/ModelBuilder.ts`              | Merges primitives into one geometry with base colour + team-colour mask  |
| `units/UnitModels.ts`                | Procedural low-poly catalogue: ships, trains, missiles, 6 building types |
| `units/UnitKinds.ts`                 | Pure: unit → model, ballistic arc maths, zoom scaling                    |
| `units/InstancedPool.ts`             | Growable `InstancedMesh` per model kind (one draw call each)             |
| `units/UnitRenderer.ts`              | Places buildings per tick; interpolates/poses movers per frame           |
| `effects/ExplosionSpecs.ts`          | Pure: dead-unit event → explosion kind/size                              |
| `effects/ParticleSystem.ts`          | GPU ring-buffer particles (fire, sparks, smoke, flash), one draw call    |
| `effects/ShockwaveRings.ts`          | Instanced expanding blast rings                                          |
| `effects/EffectsRenderer.ts`         | Fireballs, debris, smoke, mushroom clouds, rings, flash lights           |
| `LabelOverlay.ts`                    | Player names + troops on a 2D canvas, redrawn only on change             |

Integration points touched outside this folder (all additive):

- `TransformHandler.ts` — `ScreenProjector` hook.
- `WebGLFrameBuilder.ts` — `addFrameListener` (per-tick fan-out of FrameData + palette).
- `ClientGameRunner.ts` — creates the 3D view when enabled; renders it in the frame loop.
- `Main.ts` — reads the flag before the SPA rewrites the URL.

## Performance notes

- LOD 0 stride is chosen so the whole map stays ≤ ~1.5M vertices
  (`baseStrideFor`); LOD 1/2 halve and quarter that per chunk with
  distance. Chunks are frustum culled by three.js.
- Territory updates upload only dirty rows; palette uploads only on change.
- `AdaptiveQuality` lowers pixel ratio / disables shadows when the frame
  interval exceeds 24 ms and never climbs back into a level that was too slow.
- Water wave normals fade out once a wave is smaller than a pixel
  (`fwidth`), which removes distant specular aliasing.

## Testing

`tests/render3d/` (Vitest, node environment):

- `Heightfield.test.ts` — codec matches `GameMap`, land/water sign invariant on the real World map, sampling.
- `TerrainChunkGeometry.test.ts` — topology, up-facing winding, seam agreement between chunks.
- `OwnerBuffer.test.ts` — mirrors real simulation ownership (spawn + expansion) from tile deltas.
- `CameraController.test.ts` — centre mapping, tile↔screen round-trip on land, zoom parity with 2D.
- `AdaptiveQuality.test.ts` — step down / time-based reaction at low fps / no oscillation / step up / stall rejection.
- `DeviceProfile.test.ts` — phone detection and lighter budgets.

Manual check: `npm run dev`, open `http://localhost:9000/?renderer=3d`,
start a Solo game, click to spawn, expand, zoom.

## Increment log

### Increment 1 — 3D world foundation (done)

Terrain heightfield with chunked LOD, procedural materials, water, sky/fog/
shadows, territory fill + animated borders from live simulation state,
strategic camera synced to the existing controls, exact 3D picking, adaptive
quality, opt-in flag. Verified in a real Solo game in Chromium: map renders,
clicking spawns on the tile under the cursor, territory grows live.

Known gaps (planned next):

- Units, structures, names/flags, attack FX, nukes, trails and railroads are
  still drawn only by the 2D renderer (hidden in 3D mode).
- Terrain is built once; water-nuke terrain changes are not yet re-meshed.
- No free camera rotation/tilt controls yet (yaw/pitch are fixed tuning).

### Increment 2 — Laukolaroser branding + phones (done)

- Renamed to Laukolaroser throughout (UI, translations, package scope
  `@laukolaroser/*`, domains, storage keys); new logo, favicon and app icons.
  Upstream community links, Steam store promos, tutorial videos, press kit,
  tournament assets and upstream repo bots were removed. The license-required
  notice "© OpenFront and Contributors" stays in the footer and loading screen.
- `DeviceProfile`: phones start at the "low" level (pixel ratio ≤ 1, no
  shadows), never climb above "medium", skip MSAA, and use a 600k-vertex
  terrain budget. `AdaptiveQuality` cooldown is now wall-clock based, so a
  slow phone reacts within ~2 s instead of after N frames.
- Loading dialog fits narrow screens; the installed app may rotate.
- Verified on an emulated Pixel 7 (portrait and landscape) with touch: home
  page, Solo setup, game start, tap-to-spawn through the 3D projector. Under
  the same software GPU, 3D went from 3.0 to 13.3 fps after the mobile
  profile (the 2D renderer measured 1.3 fps there).

### Increment 3 — Full 3D battlefield, 3D by default (done)

- Every unit and structure is a 3D model: warships (turrets), transports,
  trade ships (containers), train engines and carriages (loaded/empty),
  atom/hydrogen bombs, MIRVs and warheads, SAM missiles, shells; cities
  (grow with level), ports (crane), factories, defense posts, SAM launchers,
  missile silos. Team-coloured parts use the owner's palette colour; build
  sites are greyed and half height.
- One `InstancedMesh` per model kind (18 draw calls total, independent of
  unit count). Movers are interpolated across ticks at the measured tick
  rate; ships bob and roll; trains follow the terrain; nukes fly parabolic
  arcs from launch to target, pitched along the arc; SAMs climb to their
  target's altitude. Models scale up as the camera pulls back.
- Explosions from simulation events: fireball, debris sparks, smoke, flash
  light, shockwave ring; nukes add a rising mushroom cloud; intercepted
  missiles burst in the air; sunk ships and destroyed buildings explode.
  Pooled GPU particles (8k + 6k desktop, 2.5k + 2k mobile), density follows
  adaptive quality, no per-particle CPU work.
- Player names + troop counts follow territory size, as in 2D.
- Railroads (with orientation) and nuclear fallout drawn on the terrain.
- 3D is now the default; `?renderer=2d` switches to the flat map.
- Fixed: owner-texture partial uploads now use single-row ranges
  (three.js uploads each range as one row; multi-row ranges raised
  `INVALID_VALUE`).
- Verified in a Solo game in Chromium: names, an AI transport at sea, AI
  cities, an in-game explosion; every model posed on the map with the game
  paused; nuke blast → smoke column.

Not yet in 3D: warship selection box, attack rings, SAM range circles,
spawn-phase highlight.

### Increment 4 — Forests, sky, orbit camera, 3D previews (done)

- `environment/ForestPlacement.ts` + `ForestRenderer.ts`: deterministic,
  clustered forests (conifers at altitude, broadleaf lower; none on
  beaches, snow or steep rock); ~14.5k trees on the World map at desktop
  density, a third of that on phones. Instanced per 256-tile region
  (frustum-culled), wind sway in the shader, hidden when zoomed far out.
- Sky dome (zenith → horizon gradient, sun glow) with matching fog; ACES
  filmic tone mapping.
- `camera/OrbitControls.ts`: rotate (`[` `]`, compass buttons, two-finger
  twist), tilt (Page Up/Down, buttons; 30°–89°), reset (Home, tap compass).
  Eased motion. Panning and zoom-to-cursor are rotation-aware
  (`ScreenProjector.screenDeltaToTiles`, perspective zoom anchoring in
  `TransformHandler.onZoom`).
- `overlays/OverlayRenderer.ts`: build ghost (green/red model + range
  ring), nuke trajectory as a 3D arc (white / amber out of SAM reach / red
  after intercept) with target ring, hover border highlight — mirrored from
  the existing 2D controller calls.
- Verified in Chromium (desktop + emulated phone): forests, rotated and
  tilted view, ghost + range ring, nuke arc, compass widget, tap-to-spawn.

### Next stages (agreed)

1. Aim-and-fire weapons (artillery, rockets, naval guns) as simulation
   intents, with 3D projectiles and impacts; more weapon, ship and train types.
2. Own backend: accounts, profiles, leaderboards, stats.
3. In-game 3D map editor (paint terrain, place nations, save/share).
4. Settings page and simplified interface; forests and terrain detail;
   positional audio.
