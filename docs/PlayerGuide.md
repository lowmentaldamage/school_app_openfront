# Laukolaroser — Player Guide

Laukolaroser is a real-time strategy game: start with a small patch of
land, grow by attacking your neighbours, build an economy and an army, and
be the last nation standing. Everything happens on a 3D battlefield that
runs in your browser on a PC or a phone.

---

## 1. Starting a game

| Button           | What it does                                                               |
| ---------------- | -------------------------------------------------------------------------- |
| **Solo**         | A game against AI nations and bots. Pick a map, difficulty and options.    |
| **Tutorial**     | A guided solo game that teaches spawning, attacking, building and nukes.   |
| **Create Lobby** | Your own game: choose the map and rules, share the link, start when ready. |
| **Join Lobby**   | Join a friend's game with its link or code, or pick one from the list.     |

On a private server you log in first with the username and password the
server admin gave you (see [SelfHosting.md](SelfHosting.md)).

When the game starts, **click (or tap) the land where you want to begin**.
You have a few seconds; pick open land away from big neighbours.

---

## 2. Controls

### PC

| Action                  | How                                                                 |
| ----------------------- | ------------------------------------------------------------------- |
| Move the map            | Drag with the left mouse button                                     |
| Zoom                    | Mouse wheel                                                         |
| Attack                  | Click land next to yours                                            |
| Menu for a tile/player  | Right-click (build, attack, alliance, info)                         |
| Turn / tilt the 3D view | Drag the compass (bottom-right), or `[` `]` and Page Up / Page Down |
| Reset the view          | Click the compass, or `Home`                                        |
| Build                   | Number keys `1`–`0`, or click an item on the bottom bar             |
| Cancel / close          | `Esc`                                                               |
| Flat 2D map             | Add `?renderer=2d` to the address (`?renderer=3d` back)             |

All keys can be changed in **Settings → Keybinds**.

### Phone / tablet

| Action            | How                                               |
| ----------------- | ------------------------------------------------- |
| Move / zoom       | Drag with one finger / pinch                      |
| Menu, then attack | Tap land, then tap the **sword** in the middle    |
| Build             | Tap your land → **wrench**                        |
| Rotate            | Twist two fingers, or drag the compass            |
| Tilt              | Slide two fingers up or down, or drag the compass |

Tip: install the game like an app — Safari: Share → _Add to Home Screen_;
Chrome: menu → _Install app_.

---

## 3. The screen

- **Bottom panel** — troops (current / maximum and growth per second),
  gold, and the **attack slider**: the share of your troops each attack
  sends. Below it the build bar: **Build** (city, factory, port, defense
  post, missile silo, SAM launcher) and **Forces** (ships, trains, nukes).
  Hover an item for its description and cost.
- **Left** — weapon buttons (artillery, naval fire, rockets).
- **Top-left** — leaderboard (click the chart icon to show/hide).
- **Top** — the player you are pointing at.
- **Top-right** — game time, speed (solo), pause, settings, exit.

---

## 4. Growing and fighting

- **Troops** regrow over time, faster when you have fewer; land and cities
  raise the maximum. Attack with a share (slider), then let them regrow.
- **Gold** comes from your workers, trade ships between ports, trains, and
  capturing enemy trade ships.
- **Alliances**: right-click / tap a player → handshake. Allies don't attack
  each other and trade more.
- **Terrain matters.** Each tile costs troops and time to take:

  | Terrain   | Troop losses | Speed        |
  | --------- | ------------ | ------------ |
  | Plains    | 1×           | fast         |
  | Highlands | ~1.6×        | ~1.6× slower |
  | Mountains | ~3×          | ~3× slower   |

  **High ground:** attacking from mountains you already hold onto the next
  peak is 25% cheaper than assaulting from below, and attacking downhill is
  15% cheaper. Fronts advance through plains and valleys first and take the
  mountains last — mountain ranges make strong natural borders. Boat
  landings never get the high-ground bonus.

- **Bots** are weak AI tribes (small grey names with low numbers) that fill
  empty land — easy early targets. **Nations** are stronger AI players.

---

## 5. Buildings

| Building     | Use                                                         |
| ------------ | ----------------------------------------------------------- |
| City         | More maximum troops and gold                                |
| Factory      | Builds railways to nearby cities/ports; spawns trade trains |
| Port (coast) | Trade ships, and builds/repairs warships                    |
| Defense Post | Stronger defence nearby; launches artillery strikes         |
| Missile Silo | Launches nukes and rockets                                  |
| SAM Launcher | Shoots down incoming nukes                                  |

Buildings can be upgraded: build again on the same one (or use its menu).

---

## 6. Navy

Build ships from the **Forces** row, then click water near one of your ports.

| Ship                 | Speed  | Strength                                                                                                                                                                 |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Warship**          | Normal | All-rounder: sinks transports, fights ships, captures trade ships                                                                                                        |
| **Destroyer**        | Fast   | Cheap escort, light guns, hunts transports and trade ships                                                                                                               |
| **Battleship**       | Slow   | Very tough, heavy long-range guns; shells enemy coasts during a war                                                                                                      |
| **Submarine**        | Normal | Stealth raider with heavy torpedoes; most ships only spot it within 8 tiles, destroyers hunt it at range; you only see enemy subs within 30 tiles of your ships or ports |
| **Aircraft Carrier** | Slow   | Floating airbase: air raids from the sea (✈️) and fighters against enemy bombers; tough, weak guns                                                                       |

Ships patrol on their own and repair at your ports. **Move them**: select
a ship by clicking it (hold **Shift and drag** to select several), then
click the water to send them there.

---

## 7. Trains

**How to start trains (step by step):**

1. Build two or more **Cities** (or **Ports**) on your land.
2. Build a **Factory** between them — cities and ports **15 to 110 tiles**
   from the factory get connected.
3. **Railways** appear on the map and **trade trains** start running on
   their own, earning gold at every city and port they reach (more when
   they visit several).
4. Upgrade the Factory to **level 2**: some trains become fast **express**
   trains (60% more gold per stop).

Military trains are built from the **Forces** row on one of your cities,
ports or factories that already has railways:

| Train             | What it does                                                               |
| ----------------- | -------------------------------------------------------------------------- |
| **Armored Train** | Patrols your railways, shells enemy land near the tracks during a land war |
| **Troop Train**   | Brings reinforcements to each of your cities it reaches                    |
| **Rail SAM**      | Mobile air defence: shoots down enemy nukes and bombers nearby             |

---

## 7b. More ways to earn gold

| Building      | Where                              | Gold per minute (level 1) |
| ------------- | ---------------------------------- | ------------------------- |
| Workers       | (everyone)                         | ~60,000                   |
| **Gold Mine** | Your highland or mountain land     | ~24,000                   |
| **Market**    | Anywhere on your land              | ~15,000                   |
| **Oil Rig**   | Water within 8 tiles of your coast | ~42,000                   |

Each upgrade level adds the same again. Oil rigs are lost if you lose the
coast next to them; gold mines make mountains worth holding.

---

## 7c. Air war (WW2 style)

1. Build an **Airbase** (Build row).
2. Pick **Air raid** (✈️) on the left, then tap a target up to 320 tiles
   away: a **bomber** flies there, drops 4 bombs (troops, ships and
   buildings in the blast — each bomb knocks a building down a level) and
   flies home. One raid per airbase every 30 seconds.
3. **Defence:** your airbases automatically send **fighters** at enemy
   bombers within 70 tiles, and your **SAM launchers** and **Rail SAMs**
   fire at bombers flying past. A bomber takes about two fighter passes to
   bring down.

## 7d. Fog of war and radar

With **Fog of war** on (lobby option, on by default) the map, territory
and borders are always visible, but enemy **units and buildings** only show
inside your sight:

- about 16 tiles beyond your own and your allies' land,
- around your ships, planes, trains and buildings (destroyers and carriers
  see furthest),
- inside your **Radar Stations'** circles (90 tiles, +20 per upgrade).

Enemy buildings stay on your map once you have seen them. Incoming nukes
and missiles are always shown. A Radar Station also lets **every** warship
of yours (and your allies') hunt enemy submarines inside its circle.

## 7e. Research (tech tree)

Press **I** or the **🔬** button (bottom-left). Pay gold to research one
tech at a time; a project takes 30 s (tier 1), 60 s (tier 2) or 90 s
(tier 3). Each tier needs the one before it in the same branch. The host
can switch the tech tree off in the lobby.

| Branch         | Tier 1 (150k)                       | Tier 2 (400k)                              | Tier 3 (900k)                            |
| -------------- | ----------------------------------- | ------------------------------------------ | ---------------------------------------- |
| Army           | Infantry Drill: −10% attack losses  | Fortification: attackers lose +15%         | Conscription: troops regrow 15% faster   |
| Navy           | Naval Gunnery: shells +20%          | Armored Hulls: warships take −25% damage   | Turbine Engines: warships sail faster    |
| Air & missiles | SAM Radar: SAM range +25%           | Heavy Bombers: +2 bombs per raid           | Interceptors: fighters and anti-air +50% |
| Economy        | Trade Routes: trade/train gold +15% | Industrialization: mines/markets/rigs +25% | Prefab Construction: buildings −15% cost |

## 8. Weapons

Use the buttons on the left. Pick a weapon, point at the target — the circle
shows the blast and turns **green** when a launcher is in range — and click.

| Weapon     | Needs        | Effect                                                  |
| ---------- | ------------ | ------------------------------------------------------- |
| Artillery  | Defense Post | Shells kill troops in the blast area                    |
| Naval fire | Any warship  | Shells from the sea                                     |
| Rocket     | Missile Silo | Long range; also knocks a building down a level         |
| Nukes      | Missile Silo | Atom bomb, hydrogen bomb, MIRV — destroy land and units |

Weapon strikes never capture land; only attacks do.

---

## 9. Settings worth knowing

- **Settings → Graphics**: the 3D view lowers its quality automatically to
  keep the frame rate at your screen's refresh rate. On an old device you
  can also switch to the flat map (`?renderer=2d`). **Day and Night**
  and **Weather** (clouds, rain, fog, storms) switch the living sky on or
  off; they are visual only and never affect the battle.
- **Settings → Keybinds**: change every key.
- **Settings → Audio**: separate sliders for music, effects, ambience,
  alerts and interface. The music is generated live — calm in peace, with
  drums when you are at war — and the world sounds follow the weather and
  the time of day.
- **Settings → Gameplay**: _Left click to open menu_ (phone-style controls
  on PC), alert frame, build-cost cursor and more.

---

## 10. Problems?

- **Slow or choppy**: close other tabs, try `?renderer=2d`, update your
  browser and graphics drivers.
- **Can't log in** (private server): ask the server admin to reset your
  password.
- **Can't create or join a lobby**: check the server is reachable; on a
  private server you must be logged in.
