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

| Ship           | Speed  | Strength                                                            |
| -------------- | ------ | ------------------------------------------------------------------- |
| **Warship**    | Normal | All-rounder: sinks transports, fights ships, captures trade ships   |
| **Destroyer**  | Fast   | Cheap escort, light guns, hunts transports and trade ships          |
| **Battleship** | Slow   | Very tough, heavy long-range guns; shells enemy coasts during a war |

Ships patrol on their own and repair at your ports. **Move them**: select
a ship by clicking it (hold **Shift and drag** to select several), then
click the water to send them there.

---

## 7. Trains

Factories connect nearby cities and ports with railways; **trade trains**
run on their own and earn gold at every stop.

| Train             | How you get it                             | What it does                                                               |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| **Express cargo** | Automatic with a level 2+ factory          | Faster, shorter train; 60% more gold per stop                              |
| **Armored Train** | Build on a city/port/factory with railways | Patrols your railways, shells enemy land near the tracks during a land war |
| **Troop Train**   | same                                       | Brings reinforcements to each of your cities it reaches                    |
| **Rail SAM**      | same                                       | Mobile air defence: shoots down enemy nukes nearby                         |

---

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
  can also switch to the flat map (`?renderer=2d`).
- **Settings → Keybinds**: change every key.
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
