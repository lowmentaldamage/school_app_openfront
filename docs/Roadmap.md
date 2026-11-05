# Laukolaroser — Feature Deep Dive & Roadmap

What can make Laukolaroser a complete 3D war-strategy game, while staying
true to its territorial style (land is won by attacking, not by
micro-managing soldiers). Every feature below is designed so that:

- the **simulation stays deterministic** (multiplayer stays in sync),
- it can be **switched on/off per game** in the lobby (and visual extras in
  the settings), as you asked: "make it best and all toggleable",
- it runs on phones (touch-first UI, adaptive quality),
- AI nations know how to use it.

Effort: S = a day, M = a few days, L = a week+, in this codebase.

---

## 0. Already done (v1.2.0)

v1.2.0: terrain in 100 layers with huge mountains, weapon power tiers
(Mk I-III), real bombers and fighters, mountains blocking shots and high
ground range, battle effects on the front, natural disasters (volcanoes,
earthquakes, tsunamis, storms, wildfires) with a lobby option.

3D battlefield (terrain with 2x render detail, water, forests, sky,
shadows), 3D units and buildings, explosions, free orbit camera,
artillery / naval bombardment / rocket strikes, Destroyer and Battleship,
express / armored / troop / rail-SAM trains, AI for all of them, private
or public self-hosted server with accounts, 3D map previews for every map,
military-command UI, phone layout, refresh-rate adaptive quality.

Since v1.0.0: Submarine and Aircraft carrier, air war (airbase, bombers,
fighters), day/night and weather, sound for every unit, fog of war with
radar, economy buildings (gold mine, market, oil rig) and defence extras
(fort, coastal battery, sea mines), tech tree, ×5 / ×10 speed, the in-game
map editor with image / heightmap / elevation upload, terrain heights
0-100, flat 2D building icons when zoomed out, and the bundled maps
Slovenija and Črna na Koroškem.

Everything planned below is now built; new ideas go at the end.

---

## 1. Navy (requested: all four)

| Ship                 | Role              | Mechanics                                                                                                                                   | Counter                              | Effort                          |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------- |
| **Destroyer**        | Cheap fast escort | Fast, light guns; auto-hunts transports and trade ships in range; patrols like warships                                                     | Warships, battleships                | M                               |
| **Submarine**        | Stealth raider    | Invisible to enemies unless within detection range of their warships/destroyers/ports; torpedoes trade ships and transports; can't hit land | Destroyers (detect + depth charge)   | L (needs per-player visibility) |
| **Battleship**       | Siege ship        | Slow, very expensive, huge health; auto-bombards enemy coast within range (uses the artillery strike rules), outranges warships             | Rockets, submarines, massed warships | M                               |
| **Aircraft carrier** | Power projection  | Launches air strikes (see §4) from sea; hangar capacity; slow                                                                               | Submarines, rockets                  | L (after air units)             |

Shared work: unit types, build rules (from ports), costs scaling with count,
3D models, AI build/use logic, build-bar + radial menu entries, toggles.

## 2. Railways (requested: all four)

| Train             | Role               | Mechanics                                                                                                                     | Effort |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| **Express cargo** | Economy            | Faster, higher-value runs between factories/ports/cities; unlocked by Factory level 2                                         | S      |
| **Troop train**   | Logistics          | Moves a chosen share of troops between two of your cities along your rails; arrives as defense bonus at the destination front | M      |
| **Armored train** | Rail combat        | Patrols your rail network, auto-shells enemy land/units next to the tracks (artillery rules, shorter range)                   | M      |
| **Rail SAM**      | Mobile air defense | Patrols rails, intercepts missiles/air units passing nearby                                                                   | M      |

## 3. Ground, economy, upgrades and defense (requested)

**Economy — more ways to earn**

- **Farms / Mines / Oil wells** (S–M): resource buildings placed on matching
  terrain (plains, mountains, coast). Produce gold; give the map's terrain
  strategic value.
- **Banks** (S): % interest on stored gold, capped.
- **Trade agreements** (M): two allies' ports/cities on a shared rail or sea
  route earn a bonus.
- **War spoils / plunder** (S): capturing buildings pays out.

**Upgrades**

- **Tech tree** (L): research (gold + time) in tiers — Logistics (faster
  boats/trains), Armor (unit health), Artillery (range), Fortification
  (defense), Economy (income). Visible in a "Research" panel.
- **Building levels** extended to every building (S–M), with visible 3D
  growth (already partly: cities grow).

**Defense**

- **Walls / fortifications** along borders (M): slow enemy advance where built.
- **Bunkers** that store troops as a reserve (M).
- **Coastal guns** that auto-fire at ships (S, reuses artillery).
- **Radar** (S): early warning for missiles and air units; needed for fog of war.
- **Defense post rework** (S): upgradable levels, visible range rings.

**Ground features & realistic terrain**

- Rivers and lakes with bridges; mountains slow attacks; forests give defense
  (terrain already affects attack speed — make it visible and explained).
- **Readability rule** (you asked): scenery never hides the game —
  trees/rocks thin out inside player territory and near borders, and fade
  when zoomed out; territory colors and borders always stay on top.
- Higher-detail terrain shading (normal-mapped rock/grass/snow), shoreline
  foam, waterfalls on steep rivers (visual only, L total but incremental).

**Actually controlling things** (you asked)

- **Select & command** (M–L): box-select your warships, destroyers, trains,
  carriers; right-click/tap to move, attack-move, patrol, hold position.
  Warships already support moves; extend to all mobile units.
- **Front orders** (M): draw a line on the map for where an attack should
  push; troops prioritize that front.
- **Rally points** for new ships (S).

## 4. Air units (requested)

- **Airfield** building; **Fighter** (intercepts aircraft and missiles),
  **Bomber** (strikes buildings, like a reusable rocket with flight time),
  **Recon plane** (reveals fog of war). Fuel/range limits; SAMs and fighters
  shoot them down. 3D aircraft with contrails. Effort L.

## 5. World & atmosphere (requested)

- **Day/night cycle** (S visual, M if it affects visibility).
- **Weather** (M): rain, snow, storms, fog banks; optional gameplay (storms
  slow boats, fog reduces visibility).
- **Sound & music** (M): 3D positional battle audio (Howler), explosions,
  ships, trains, ambient wind/sea; adaptive music (calm → battle); volume
  sliders and mute per category.

## 6. Fog of war (requested)

You see enemy units/buildings only near your territory, units, radar and
recon. Requires per-player visibility computed client-side from the
deterministic state (cheap) — the simulation itself stays fully known to
every client, so it is a **visual** fog (good for friends; for competitive
anti-cheat a server-side variant would be needed). Effort M–L.

## 7. Toggles (requested: everything toggleable)

- **Game rules** (lobby, per game): each new unit, weapon, economy feature,
  fog of war, weather gameplay — on/off, saved as presets ("Classic",
  "Modern War", "Total War").
- **Client settings**: 3D on/off, quality preset, shadows, forests, weather
  visuals, effects density, sound/music volumes, camera tilt limits,
  color-blind mode (exists), UI scale.

## 8. Polish: design & performance

- One consistent visual language for HUD (glass panels, icons, spacing) and
  a simpler first-run (fewer buttons, contextual hints).
- Performance: units/effects already instanced; next: GPU-side unit
  interpolation, worker-side frame preparation, texture compression,
  lazy-loaded forests per region, mobile render scale presets, 30/60 FPS cap
  option to save battery.

## 9. Your home server (requested)

Requirements from you: home Linux server; up to **30 players in 2 games at
once**; **≤ 2 GB RAM**, little CPU; **private accounts** — only you (admin)
create/remove players and set passwords; any logged-in player can create
games; playable from anywhere on phone or PC.

Design:

- **Self-hosted mode** (`SELF_HOSTED=1`): the game server issues its own
  login tokens (Ed25519, key generated on first start), stores accounts in
  a small file with scrypt-hashed passwords — no external services.
- **Login screen** before the menu; **Admin panel** (only for you): add
  player (username + password), reset password, disable/remove.
- **Docker Compose** package: one container (nginx + game server), a data
  volume for accounts, memory limit 2 GB, 2 game workers.
- **Reaching it from anywhere**: either port-forward 443 on your router with
  a domain (Let's Encrypt HTTPS), or a free **Cloudflare Tunnel** (no open
  ports). Phones can "Add to Home Screen" to install it like an app.

Capacity estimate: the simulation runs on each player's device; the server
only relays player actions, so 2 games × 15 players fits comfortably in
~300–600 MB RAM and a fraction of one CPU core.

---

## Proposed order

1. **Home server + private accounts** (you can play anywhere, every later
   feature reaches you immediately).
2. **Navy I**: Destroyer, Battleship, Express cargo, Armored train + toggles.
3. **Control**: select & command for all mobile units.
4. **Economy & defense**: resource buildings, banks, coastal guns, walls,
   defense rework, tech tree (in tiers).
5. **Sound & music**, day/night + weather.
6. **Navy II + Air**: Submarine, Fog of war, Airfield/air units, Carrier,
   Rail SAM, Troop train.
7. Terrain realism passes and UI/perf polish throughout.
