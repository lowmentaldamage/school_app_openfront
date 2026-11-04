📦 **Laukolaroser v1.1.0**

🆕 **New in v1.1.0**

- Map editor (Map Editor on the home screen): paint water, plains, highland and mountains in 2D or live 3D, raise or lower ground, undo/redo; start blank, from any game map or from random islands
- Upload any map: pictures (PNG, JPG, WebP, SVG…), heightmaps (16-bit PNG, TIFF, RAW/R16, PGM) or real elevation data (GeoTIFF, SRTM .hgt, ESRI .asc, CSV); it turns into a 3D map that spins 360°, with automatic hills and mountains for flat pictures
- Place nations by hand or automatically (any number, spread over the land), set the map's tribes, save it on the server: everyone plays it under Custom maps in Solo and Create Lobby; admins can delete maps
- New maps: Slovenija (14 cities at their real places), Črna na Koroškem and Črna na Koroškem 2
- Terrain heights from 0 (ground) to 100 (mountain tops) instead of 31 steps: smooth slopes on every map
- Zoomed out, buildings become flat 2D icons in their owner's colour, so stacked buildings stay easy to see and click (Settings → Graphics → Flat building icons)
- Camera: arrow keys turn and tilt, Reset view button, two-finger twist on phones; ×5 and ×10 game speed
- Air war: Airbase, bomber raids, fighter interception; Submarine and Aircraft Carrier
- Economy buildings: Gold Mine (more on mountains), Market, Oil Rig
- Defense extras: Fort (attackers near it lose 3× more and move half as fast), Coastal Battery (shells enemy ships), Sea Mines (hidden; destroyers sweep them)
- Tech tree (lobby option, on by default): 12 techs in Army, Navy, Air & missiles and Economy (🔬 button or key I); AI nations research too
- Fog of war (lobby option, on by default) and the Radar Station
- Day and night, weather, a generated soundtrack and sounds for every unit (Settings → Graphics / Audio)
- Build bar help: hover any building or unit for how to use it and its exact numbers ("?" toggles it)
- Private server: up to 100 approved accounts, 2 devices per login, lockout after 10 wrong passwords (admin unlocks), synced stats and settings, quick account switching
- Windows: one-click zip (no install); Android: APK

🌍 **3D battlefield**

- Terrain heights, coasts, snow-capped mountains, animated water, fog and shadows
- 3D warships, transports, trade ships, trains, nukes, MIRVs and SAM missiles
- 3D cities, ports, factories, defense posts, SAM launchers and missile silos
- Explosions, shockwaves and mushroom clouds; railroads and fallout on the map
- Territory colours, animated borders and player names live on the terrain
- Clicks and taps land on the exact tile under the pointer, even on mountains
- Forests, a living sky and cinematic lighting
- Rotate and tilt the camera: `[` `]`, Page Up/Down, Home, the on-screen compass, or twist two fingers
- Build previews, range rings and nuke flight paths shown in 3D
- Classic flat map still available with `?renderer=2d`
- Conquest animation: captured land flashes in the new owner's colour as the front advances
- Detailed buildings: windowed towers, brick and metal facades; city windows light up at night
- Vehicles turn smoothly; ships heel in turns, planes bank, take off and land at their base; new buildings rise from the ground

📱 **Phones**

- Mobile-tuned rendering quality and layout

💥 **Weapons**

- Artillery barrages from Defense Posts, naval bombardment from Warships, rocket strikes from Missile Silos
- Pick a weapon on the left, tap a target; the reticle shows the blast and turns green when in range
- Strikes kill enemy troops, sink ships and damage buildings — but only attacks take land
- AI nations use them in their wars too

🎨 **New identity**

- The game is now called Laukolaroser, with a new logo and icon

🏠 **Host your own server**

- Private mode: every player logs in with a username and password you give them
- Admins add, remove, disable players, reset passwords and make other admins from the in-game menu
- Anyone logged in can create and join lobbies
- One-command Docker setup capped at 2 GB RAM; play over the internet with HTTPS (see docs/SelfHosting.md)

⚓ **New warships**

- **Destroyer**: cheap and fast escort with light guns — hunts transports and trade ships
- **Battleship**: slow, very tough siege ship with heavy long-range guns; shells enemy coasts on its own while you fight a land war
- Both are built from ports, take move orders like warships and fire naval strikes
- AI nations build them too; switch either off in the lobby's disabled units

🚂 **Trains**

- **Express cargo**: once you have a level 2 factory, some trains run as faster, shorter expresses that earn 60% more per stop
- **Armored Train**: patrols your railways and shells enemy land next to the tracks during a land war
- **Troop Train**: patrols your railways and brings reinforcements to every city it reaches
- **Rail SAM**: mobile air defence on your railways that shoots down enemy nukes flying nearby
- Build military trains from the build bar on a city, port or factory with railways; AI nations use them too; each can be switched off in the lobby

🗺️ **Maps in 3D**

- Sharper 3D terrain on every map: twice the detail, smooth coastlines, finer mountains (looks only — the game map is unchanged)
- Map picker and lobby show each map rendered in 3D

🎨 **Interface**

- New military-command look across every screen
- Build bar split into Build and Forces rows with bigger icons
- Tutorial tips as a small card at the top; only shown in the guided Tutorial game
- Simpler menu: Solo, Tutorial, Create Lobby, Join Lobby
- Drag the compass to turn 360° and tilt; on phones slide two fingers to tilt
- Clearer borders and colours, trees cleared from claimed land, taller mountains
- Faster: much lighter forests and labels, quality follows your screen's refresh rate (up to 120 Hz and more)
- Quick guide in Help for the 3D camera, ships, trains and weapons

⛰️ **Terrain warfare**

- Mountains are now about 3x as costly and slow to invade as plains, highlands about 1.6x
- High ground: attacking from your own mountains or downhill is cheaper than assaulting from below
- Fronts push through plains and valleys first and take mountains last — ranges make natural borders

✈️ **Air war**

- Airbase: launch bomber raids (Weapons → Air raid) — the bomber flies there, bombs troops, ships and buildings and flies home
- Airbases scramble fighters at enemy bombers nearby; SAM launchers and Rail SAMs fire at them too

💰 **More ways to earn gold**

- Gold Mine on highland or mountain land, Market anywhere, Oil Rig off your coast
- Weapon strikes are free with Infinite gold, like buildings

🗺️ **Clearer map**

- Ships, trains and planes stay small when zoomed out; trade ships are hidden when the whole map is in view
- Less surface grain on land
- Trains explained step by step in Help and in the Factory description

🌊 **Submarines and carriers**

- Submarine: stealth raider with heavy torpedoes — most ships only spot it up close, destroyers hunt it, and enemies can't see it unless their ships or ports are near
- Aircraft Carrier: a floating airbase that launches air raids from the sea and sends fighters at enemy bombers
