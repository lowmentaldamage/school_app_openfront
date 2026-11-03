<p align="center">
  <img src="resources/images/LaukolaroserLogo.svg" alt="Laukolaroser" width="320">
</p>

**Laukolaroser** is a real-time multiplayer strategy game on a 3D
battlefield. Grow your nation across real-world maps, conquer neighbours,
build cities, ports and defences, forge alliances — in the browser, on
desktop or on your phone.

![CI](https://github.com/lowmentaldamage/school_app_openfront/actions/workflows/ci.yml/badge.svg)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Assets: CC BY-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## Features

- **3D battlefield** — terrain with mountains, coasts and snow, animated water, living territory borders, 3D ships, trains, missiles and buildings, explosions and mushroom clouds, lighting, fog and shadows (Three.js).
- **Real-time strategy** — expand, attack, defend, trade, nuke.
- **Weapons** — aim-and-fire artillery, naval bombardment and rocket strikes.
- **Navy** — warships, fast destroyers and coast-shelling battleships.
- **Trains** — trade and express trains, armored trains, troop trains and rail SAMs.
- **Free 3D camera** — turn 360° and tilt, on PC and phone.
- **Multiplayer** — deterministic lockstep simulation over WebSockets, lobbies and solo games against nations and bots.
- **Phone ready** — touch controls, adaptive rendering quality and a mobile-first layout.
- **Many maps** — real-world regions and fictional worlds.
- **Host it yourself** — private server with player accounts you manage, or a public one; play from phone or PC anywhere.

## Documentation

| Guide                                     | For                                       |
| ----------------------------------------- | ----------------------------------------- |
| [Player Guide](docs/PlayerGuide.md)       | How to play: controls, units, tips        |
| [Server Admin Guide](docs/SelfHosting.md) | Running your own server, accounts, HTTPS  |
| [Developer Guide](docs/DeveloperGuide.md) | Code layout, adding units and maps, tests |
| [3D renderer](docs/World3D.md)            | Design decisions and change log           |
| [Roadmap](docs/Roadmap.md)                | Planned features                          |

## Quick start

Requires Node.js 24 (≥ 24.15) and npm 12 (≥ 12.1).

```bash
git clone -b ccr-f2fe3bd8-k0h6kk https://github.com/lowmentaldamage/school_app_openfront laukolaroser
cd laukolaroser
npm run inst          # npm ci --ignore-scripts
npm run dev           # client (http://localhost:9000) + game server
```

The 3D battlefield is the default. Append `?renderer=2d` to the URL for the
classic flat map (`?renderer=3d` switches back). See
[docs/World3D.md](docs/World3D.md).

## Your own server

```bash
cd deploy/selfhost && cp .env.example .env   # set ADMIN_USER / ADMIN_PASSWORD
docker compose up -d --build                  # http://SERVER-IP:8080
```

Full guide (accounts, HTTPS, playing over the internet):
[docs/SelfHosting.md](docs/SelfHosting.md). Planned features:
[docs/Roadmap.md](docs/Roadmap.md).

## Commands

```bash
npm run dev           # client + server with hot reload
npm run start:client  # client only
npm run start:server-dev
npm test              # Vitest
npm run typecheck
npm run lint          # Oxlint
npm run format        # Oxfmt
npm run build-prod    # production build
npm run start:selfhost                 # server in self-hosted (accounts) mode
npm run selfhost:admin -- list         # manage accounts from the shell
```

## Architecture

- `packages/` — deterministic game engine (runs in a Web Worker on every client) and shared schemas.
- `src/client/` — UI (Lit + Tailwind), input, networking, the 2D WebGL renderer (`render/`) and the 3D renderer (`render3d/`).
- `src/server/` — lobby/game coordination and intent relay over WebSockets.

See [docs/World3D.md](docs/World3D.md) for the 3D renderer design and roadmap,
and [docs/Architecture.md](docs/Architecture.md) for the engine.

## License

Code: **GNU AGPL v3.0** — see [LICENSE](LICENSE). Assets in `resources/`:
**CC BY-SA 4.0** — see [LICENSE-ASSETS](LICENSE-ASSETS). License history and
attribution: [LICENSING.md](LICENSING.md), [CREDITS.md](CREDITS.md).

Laukolaroser is a modified version of the open-source game OpenFront. As
required by the license's additional terms, the notice
"© OpenFront and Contributors" is shown in the footer and on the loading
screen, and must be preserved.
