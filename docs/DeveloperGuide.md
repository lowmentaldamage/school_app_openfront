# Laukolaroser — Developer Guide

How the code is organised and how to change it safely. See also
[Architecture.md](Architecture.md) (engine), [World3D.md](World3D.md) (3D
renderer, decisions and increment log) and `CLAUDE.md` (rules and
commands).

---

## 1. Setup

```bash
# Node.js 24.15+ and npm 12.1+
npm run inst        # npm ci --ignore-scripts (never `npm install`)
npm run dev         # client http://localhost:9000 + game server, hot reload
```

| Command                   | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `npm test`                | All tests (Vitest)                                   |
| `npm run test:changed`    | Tests affected by your changes                       |
| `npx vitest <file> --run` | One file                                             |
| `npm run typecheck`       | `tsc` for root and every package                     |
| `npm run lint` / `format` | Oxlint / Oxfmt                                       |
| `npm run build-prod`      | Production build                                     |
| `npm run maps:3d`         | Render + check every map in 3D (needs `npm run dev`) |
| `npm run selfhost:admin`  | Manage self-host accounts from the shell             |

---

## 2. Layout

| Path                  | What                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `packages/engine-api` | Contract: intent/config schemas, `UnitType` and game types, updates                        |
| `packages/engine-lib` | Shared rules: config, PRNG, `DetMath`, weapons, naval classes, rail units                  |
| `packages/engine`     | The deterministic simulation: executions, `*Impl`, AI, snapshots                           |
| `packages/shared`     | Client/server code: wire schemas, map loaders, asset URLs                                  |
| `src/client`          | UI (Lit + Tailwind), input, networking, 2D renderer (`render/`), 3D renderer (`render3d/`) |
| `src/server`          | Lobbies, intent relay, self-host accounts (`selfhost/`)                                    |
| `resources/`          | Maps, images, translations (`lang/en.json`), changelog                                     |
| `deploy/selfhost`     | Docker Compose for your own server                                                         |
| `scripts/`            | Tools: `maps-3d.cjs`, `selfhost-admin.ts`, …                                               |

Import packages as `@laukolaroser/<pkg>/<path>`. Allowed imports are
enforced by `tests/LayerBoundaries.test.ts`.

---

## 3. The simulation (deterministic lockstep)

Every client runs the same simulation; the server only relays intents.

1. Player action → **Intent** (zod schema in `engine-api/src/Schemas.ts`).
2. Server bundles a turn → all clients.
3. Each intent becomes an **Execution** (`packages/engine/src/execution`).
4. `executeNextTick()` runs all executions; **GameUpdates** go to the client.

Rules that keep games in sync:

- Use `PseudoRandom` (seeded), never `Math.random`; no `Date.now`.
- Use `engine-lib/DetMath` instead of `Math.sin/pow/exp/log/...`.
- Integer maths for gold/damage where possible.
- An execution that stays alive across ticks needs a **snapshot type**
  (`execSnapshotType`) registered in `snapshot/ExecutionRegistry.ts`.
- AI behaviours that must not disturb existing games use **their own
  PseudoRandom** seeded from tick + player (see `NationNavyBehavior`).
- Engine changes must come with tests (`tests/`, using `setup()` from
  `tests/util/Setup.ts`).

---

## 4. Recipes

### Add a unit type

1. `engine-api/src/game/GameTypes.ts`: add to `UnitType` (and a group such
   as `CombatShips` / `RailUnits` / `BuildableAttacks`).
2. `engine-lib/src/game/PackedUnitUpdates.ts`: append to `PACKED_UNIT_TYPES`
   (append only — the index is on the wire).
3. `engine/src/game/Game.ts`: `UnitParamsMap` entry.
4. Rules: `Config.unitInfo` (health), `EngineConfig.unitCost`,
   `PlayerImpl.canSpawnUnitType` (where it may spawn).
5. Behaviour: an execution, created in `ConstructionExecution`.
6. Client: build bar (`hud/layers/UnitDisplay.ts`), build menu
   (`hud/layers/BuildMenu.ts`), lobby toggle (`components/GameConfigSettings.ts`),
   icon (`resources/images`), 2D sprite (`hud/SpriteLoader.ts`,
   `render/gl/passes/UnitPass.ts`), 3D model (`render3d/units/UnitModels.ts`
   - `UnitKinds.ts`), text in `resources/lang/en.json` (keep keys sorted).
7. AI: a `nation/*Behavior.ts`, called from `NationExecution`.
8. Tests: unit rules, behaviour, snapshot round trip
   (`expectSnapshotRoundTrip`); add it to `tests/util/ScriptedGame.ts` so
   the full-game snapshot test covers its execution.

Examples to copy: Destroyer/Battleship (`engine-lib/naval/NavalClasses.ts`,
`WarshipExecution`), military trains (`engine-lib/rail/RailUnits.ts`,
`RailUnitExecution`), weapons (`engine-lib/weapons/Weapons.ts`,
`WeaponStrikeExecution`, `ProjectileExecution`).

### Add a map

Maps are generated by the Go tool in `map-generator/` (`npm run gen-maps`,
see `map-generator/README.md` and `docs/Maps.md`). After adding one:

```bash
npm run dev                         # in one terminal
npm run maps:3d -- --maps mymap --write
```

This writes `resources/maps/mymap/preview3d.webp` (the 3D picture used in
the menus) and checks the render. `npm run maps:3d -- --write` redoes all
maps; the report is `map-3d-report.json`; the command fails if any map
renders badly. It needs Playwright Chromium
(`npm i --no-save playwright && npx playwright install chromium`).

### Change the UI

- Text: always `translateText("key")` + an entry in `resources/lang/en.json`
  (alphabetical). Do not edit other language files (Crowdin).
- Colours: the military-command theme redefines Tailwind's palette in
  `src/client/styles.css` (`gray/zinc/slate` = olive-slate, `blue` = army
  green, `sky` = amber). Use those utilities rather than raw colours.
- HUD layout lives in `index.html` (bottom HUD grid) and the Lit
  components in `src/client/hud/layers/`.
- The homepage must not statically import game-client code (see
  `CLAUDE.md`).

### The 3D renderer

`src/client/render3d/` (three.js) draws the map from `FrameData`; the 2D
camera (`TransformHandler`) stays the source of truth. Key parts:

| Module                         | Role                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `terrain/Heightfield.ts`       | Tile terrain → heights (exaggerated relief)           |
| `terrain/TerrainDetail.ts`     | Per-tile height + land texture, 2x upscale on desktop |
| `terrain/TerrainMaterial.ts`   | Terrain shading, biomes, per-pixel normals            |
| `territory/TerritoryShader.ts` | Territory fill, borders, railways, fallout            |
| `environment/*`                | Water, sky/fog/light, forests                         |
| `units/*`                      | Instanced unit and building models                    |
| `LabelOverlay.ts`              | Names/troops (cached sprites, declutter)              |
| `AdaptiveQuality.ts`           | Quality levels following the display refresh rate     |
| `camera/*`                     | Camera mapping, orbit controls, compass               |
| `tools/MapPreviewPage.ts`      | Offline map renders for `maps:3d`                     |

Rules: instanced/batched drawing only, extend `MeshStandardMaterial` via
`onBeforeCompile`, keep GPU-free logic unit-testable in `tests/render3d/`.

---

## 5. Self-host server internals

`src/server/selfhost/`: `AccountStore` (accounts.json, scrypt),
`SessionToken` (HS256 JWT signed with the per-server secret),
`SelfHostRoutes` (`/api/selfhost/*`), `SelfHostAuth`. `SELF_HOSTED=1`
enables it; `verifyClientToken` then accepts only these tokens. In public
mode `/api/selfhost/status` answers `{enabled:false, ownServer:true}` so
the client allows lobbies without the upstream API. Client side:
`src/client/selfhost/`.

---

## 6. Before you push

```bash
npm run typecheck && npm run lint && npm run format
npm run test:changed       # CI runs the full suite
```

Benchmark snapshots (`tests/__snapshots__/NationGoldPerMinute*`) change
when the game balance changes; review the diff and update with
`npx vitest <file> --run -u`.
