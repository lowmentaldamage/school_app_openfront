# Laukolaroser — Server Admin Guide

Run Laukolaroser on your own Linux machine and play from anywhere, on
phones and PCs.

Two modes (one setting, `PRIVATE` in `.env`):

| Mode                       | Who can play                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Private** (`1`, default) | Only players you create, each with a username and password. Admins add/remove players; anyone logged in can create games. |
| **Public** (`0`)           | Anyone with the link, no login.                                                                                           |

**Requirements:** 64-bit Linux with Docker, **2 GB RAM** and 1–2 CPU cores
for 2 games × 15 players. The game simulation runs on each player's
device; the server only relays moves, so it stays light (about 210–290 MB
idle and about 440 MB after a two-player game in testing).

---

## 1. Install Docker (once)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

## 2. Get the game and start it

```bash
git clone https://github.com/lowmentaldamage/school_app_openfront laukolaroser
cd laukolaroser/deploy/selfhost
cp .env.example .env
nano .env                 # PRIVATE, ADMIN_USER, ADMIN_PASSWORD, PORT, DOMAIN
docker compose up -d --build
```

The first build takes several minutes. Open **http://SERVER-IP:8080** from
any device on your network. In private mode, log in with the admin account.

`.env` settings:

| Setting                         | Meaning                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| `PRIVATE`                       | `1` = accounts required (default), `0` = public                  |
| `ADMIN_USER` / `ADMIN_PASSWORD` | First admin; only used while no accounts exist                   |
| `PORT`                          | Port on your server (default 8080)                               |
| `DOMAIN`                        | Your public hostname (e.g. `game.example.com`), else `localhost` |

After editing `.env`: `docker compose up -d`.

## 3. Players and admins (private mode)

**There is no default username or password.** The first admin is the one
you set in `.env` (`ADMIN_USER` / `ADMIN_PASSWORD`) before the first start
(or type when the Windows zip / `npm run play` asks). After that you add or
approve everyone else in the game.

A private server is a closed group: only accounts you approve can play
— with each other in lobbies, or solo against bots and AI nations.

| Rule                        | Default | Change with (in `deploy/selfhost/.env`) |
| --------------------------- | ------- | --------------------------------------- |
| Accounts on the server      | 100     | `MAX_ACCOUNTS=30` (any number)          |
| Devices per account         | 2       | `MAX_DEVICES=2`                         |
| Players can ask for access  | on      | `REGISTRATION=off` (you add everyone)   |
| Wrong passwords before lock | 10      | `MAX_FAILED_LOGINS=10`                  |

Then `docker compose up -d` again.

**How players join:** they open your server's address (browser or the
Android app), tap **Request access**, pick a username and password. The
request waits until you approve it. They cannot play before that.

In the game menu tap your name (bottom-left) → **Manage players**:

- **Approve** a request (shown first, marked _Request_), or **Remove** it.
- **Add player**: username (3–24 letters, digits, `_ . -`) + password
  (6+ characters); tick _Admin_ to create another admin.
- **Devices** shows how many of the device slots are used (hover for the
  device names and when each was last seen). **Free devices** signs the
  account out everywhere and frees both slots, e.g. when a player gets a
  new phone. A third device is refused with a message to ask you.
- **Stats**: wins / games and hours played (multiplayer and solo).
- **Locked** accounts (🔒, listed first): after 10 wrong passwords in a row
  an account locks — even the right password is refused — until you press
  **Unlock** (or reset its password). Players see a warning when 3, 2 and
  1 tries are left.
- **Reset password**, **Disable / Enable**, **Make admin / player**,
  **Remove**.

**Admin dashboard link:** open `http://<server>/#admin` (logged in as an
admin) to jump straight to Manage players. Add it to your phone's home
screen (Chrome: ⋮ → _Add to Home screen_; Safari: Share → _Add to Home
Screen_) and to your Windows taskbar / bookmarks; only admin accounts see
the panel.

### Approve from Telegram (optional)

A Telegram bot can message you about every access request with
**✅ Approve** / **❌ Reject** buttons, and about accounts that lock after
10 wrong passwords with an **🔓 Unlock** button. It polls Telegram itself,
so it works on a home server with no open ports.

1. In Telegram open **@BotFather** → `/newbot` → pick a name → copy the
   token.
2. In `deploy/selfhost/.env` set `TELEGRAM_BOT_TOKEN=<token>` and run
   `docker compose up -d`.
3. Send `/start` to your new bot. It answers with your chat id.
4. Set `TELEGRAM_ADMIN_CHAT_ID=<that number>` (several admins: comma
   separated) and run `docker compose up -d` again.

Commands: `/pending` (requests waiting, with buttons), `/players`,
`/approve <name>`, `/reject <name>`, `/unlock <name>`, `/devices <name>`
(free their device slots), `/help`. Only the chat ids you list can use
them; anyone else only gets told their own chat id.

**Switching players on a shared device:** tap your name (bottom-left) →
**Switch player** lists everyone signed in on this device (one tap, no
password), **+ Add another player** signs in someone else. The login
screen also shows "Tap to continue as …". Each account still counts the
shared device as one of its 2 devices.

Each player's **settings** (keybinds, sound, gameplay options, day/night
and weather) follow their account to every device; graphics quality stays
per device. Players see their own stats in the same menu.

Changes apply immediately: a disabled or removed player cannot join new
games, and a password reset logs out that player's old sessions. Players
change their own password from the same menu. Logins last 30 days.

From the server shell (e.g. if you forgot the admin password):

```bash
cd laukolaroser/deploy/selfhost
docker compose exec game npx tsx scripts/selfhost-admin.ts list
docker compose exec game npx tsx scripts/selfhost-admin.ts passwd <user> <new-password>
docker compose exec game npx tsx scripts/selfhost-admin.ts add <user> <password> admin
docker compose exec game npx tsx scripts/selfhost-admin.ts disable <user>
docker compose exec game npx tsx scripts/selfhost-admin.ts remove <user>
docker compose exec game npx tsx scripts/selfhost-admin.ts approve <user>
docker compose exec game npx tsx scripts/selfhost-admin.ts devices <user>   # free device slots
docker compose exec game npx tsx scripts/selfhost-admin.ts unlock <user>    # after 10 wrong passwords
```

The last admin cannot be removed, disabled or demoted, so you cannot lock
yourself out from the menu.

### Custom maps

Maps made in the in-game map editor are saved in `data/maps/<id>/` (the
same data folder as the accounts). Every logged-in player can save maps;
only admins can delete them (✕ on the map card under Custom maps). At most
200 maps are kept. Back them up with the rest of `data/`.
Maps in `resources/custom-maps/` (Slovenija, Črna na Koroškem 1 and 2) ship with the
game and are installed on first start; if an admin deletes one, it stays
deleted.

## 4. Play from anywhere

### Option A — Cloudflare Tunnel (recommended, no router changes, free HTTPS)

1. Put a domain on Cloudflare, e.g. `example.com`.
2. On the server:
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb
   cloudflared tunnel login
   cloudflared tunnel create laukolaroser
   cloudflared tunnel route dns laukolaroser game.example.com
   cloudflared tunnel run --url http://localhost:8080 laukolaroser
   ```
   To keep it running after reboots: `sudo cloudflared service install`
   with a config file (Cloudflare's "Run as a service" guide).
3. Set `DOMAIN=game.example.com` in `.env`, then `docker compose up -d`.
4. Everyone opens **https://game.example.com**.

### Option B — Port forwarding + HTTPS

1. On your router forward TCP **443** and **80** to the server.
2. Put a reverse proxy with automatic HTTPS in front, e.g. Caddy
   (`/etc/caddy/Caddyfile`):
   ```
   game.example.com {
       reverse_proxy localhost:8080
   }
   ```
3. Point `game.example.com` at your home IP (use dynamic DNS if it
   changes) and set `DOMAIN` in `.env`.

WebSockets must pass through the proxy (Caddy and Cloudflare do this by
default). Use HTTPS when playing over the internet.

## 5. Install on phones and PCs

- **iPhone/iPad (Safari):** Share → _Add to Home Screen_.
- **Android (Chrome):** menu → _Install app_ / _Add to Home screen_.
- **PC (Chrome/Edge):** the install icon in the address bar.

## 6. Updating

```bash
cd laukolaroser && git pull
cd deploy/selfhost && docker compose up -d --build
```

Accounts in `deploy/selfhost/data/` are kept.

## 7. Backups

Everything worth keeping is in `deploy/selfhost/data/`:
`accounts.json` (scrypt-hashed passwords, never plain text; devices),
`stats/` and `settings/` (one small file per player), and
`session-secret` (signs logins; if lost, everyone logs in again).

```bash
tar czf laukolaroser-backup-$(date +%F).tgz -C laukolaroser/deploy/selfhost data
```

## 8. Resource limits

`docker-compose.yml` caps the container at **2 GB RAM / 2 CPUs** and runs
2 game workers with a 320 MB heap each. To change: edit `mem_limit`,
`cpus` and `NUM_WORKERS` there.

## 9. Troubleshooting

| Problem                              | Fix                                                              |
| ------------------------------------ | ---------------------------------------------------------------- |
| Page does not load                   | `docker compose ps` (is it `healthy`?), `docker compose logs -f` |
| Build fails downloading packages     | The server needs internet access during the build; retry         |
| "Wrong username or password"         | Reset it: `selfhost-admin.ts passwd <user> <pw>`                 |
| Too many failed logins               | Logins are rate-limited per IP; wait 10 minutes                  |
| Works at home, not outside           | Check the tunnel / port forward and `DOMAIN`; use HTTPS          |
| Players disconnect over the internet | Make sure the proxy passes WebSockets                            |
| Out of memory                        | Fewer `NUM_WORKERS`, or raise `mem_limit`                        |

## 10. Without Docker (testing only)

For a quick test on a PC (Node.js 24 and npm 12 required):

```bash
npm run inst
SELF_HOSTED=1 SELFHOST_DATA_DIR=./data \
  SELFHOST_ADMIN_USER=admin SELFHOST_ADMIN_PASSWORD=change-me npm run dev
```

Open http://localhost:9000 (leave out `SELF_HOSTED=1` for public mode).
This is the development server; for real hosting use Docker, which also
serves the built game files through nginx.

## 11. Security notes

- Use strong passwords; failed logins are rate-limited per IP.
- Use HTTPS (Option A or B) when playing over the internet.
- Private mode turns off the upstream online services (store, global
  leaderboard, sign-in providers); everything runs on your server.

## License

Laukolaroser is licensed under the GNU AGPL v3 (see `LICENSE`,
`LICENSING.md`, `CREDITS.md`). If others play on your server, they must be
able to get the source code — the footer links to the repository. Keep the
"© OpenFront and Contributors" notice visible.
