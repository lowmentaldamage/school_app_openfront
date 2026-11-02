# World Front 3D — Architecture & Progress

World Front 3D turns OpenFront into a 3D strategy game by adding a new
Three.js rendering layer on top of the unchanged OpenFront simulation,
networking and UI. This document records the architectural decisions and
the state of each increment.

## Origin and licensing

- Imported from [OpenFrontIO](https://github.com/openfrontio/OpenFrontIO) at
  commit `103bba550d3a39ceb623179a04687719cf8a051b`.
- Code: AGPL-3.0 (see `LICENSE`, `LICENSING.md`). Open assets under
  `resources/`: CC BY-SA 4.0 (`LICENSE-ASSETS`, `CREDITS.md`). All upstream
  notices are kept intact.
- The upstream `proprietary/` directory (All Rights Reserved, licensed only
  for use within OpenFront itself) is **not** included. The build already
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

| Module                               | Role                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `WorldRenderer.ts`                   | Owns the `WebGLRenderer` and scene; composes everything below            |
| `World3DView.ts`                     | Game glue: canvas, per-tick feed, `ScreenProjector` for input            |
| `World3DFlag.ts`                     | `?renderer=3d` flag (no three.js import; safe for the homepage)          |
| `AdaptiveQuality.ts`                 | Frame-time driven quality levels (pixel ratio, shadows, shadow map size) |
| `terrain/TerrainCodec.ts`            | Decodes `GameMap.terrainByte` bits                                       |
| `terrain/Heightfield.ts`             | Terrain bytes → smoothed elevation (land > 0 > water, guaranteed)       |
| `terrain/TerrainChunkGeometry.ts`    | Pure chunk mesh builder (shared-edge normals, crack-hiding skirts)       |
| `terrain/TerrainRenderer.ts`         | 128-tile chunks × 3 LOD levels (`THREE.LOD`), frustum culled             |
| `terrain/TerrainMaterial.ts`         | Procedural albedo (sand/grass/highland/rock/snow) + territory overlay    |
| `territory/OwnerBuffer.ts`           | CPU mirror of tile ownership with dirty-row tracking                     |
| `territory/TerritoryTextures.ts`     | Owner + palette `DataTexture`s, partial uploads                          |
| `territory/TerritoryShader.ts`       | GLSL: territory fill, animated borders, highlight                        |
| `environment/EnvironmentRenderer.ts` | Sky, fog, hemisphere + sun light, camera-fitted shadow frustum           |
| `environment/WaterRenderer.ts`       | Sea plane: depth colour, foam, anti-aliased animated wave normals        |
| `camera/CameraController.ts`         | 2D camera state → perspective camera; screen ↔ tile picking              |

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
- `AdaptiveQuality.test.ts` — step down / no oscillation / step up / stall rejection.

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

### Next increments

2. `UnitRenderer` / `ArmyRenderer` — instanced 3D units (warships, transports, trains) from `FrameData.units`.
3. `BuildingRenderer` — instanced structures (cities, ports, silos, SAMs, factories) with levels.
4. `EnvironmentRenderer` scatter — instanced forests/rocks by biome, culled per chunk.
5. `EffectsRenderer` — pooled particle explosions, smoke, fire, nuke shockwaves from `FrameData.events`.
6. Names/flags as world-space labels; selection & hover highlight (`SelectionManager`).
7. Camera rotate/tilt input, `AudioManager` positional audio (Howler), settings UI toggle.
