# Run Laukolaroser on your own server

A private server for you and your friends: only people you add can play,
anyone you add can create games, and you can play from anywhere on a phone
or a PC.

**Requirements:** a Linux machine with Docker (any 64-bit distro), about
**2 GB RAM** and 1–2 CPU cores for 2 games × 15 players. The game
simulation runs on each player's device; the server only relays moves, so
it stays light.

---

## 1. Install Docker (once)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out and back in afterwards
```

## 2. Get the game and start it

```bash
git clone https://github.com/lowmentaldamage/school_app_openfront laukolaroser
cd laukolaroser/deploy/selfhost
cp .env.example .env
nano .env        # set ADMIN_USER and ADMIN_PASSWORD (your admin login)
docker compose up -d --build
```

The first build takes a few minutes. Then open **http://SERVER-IP:8080**
from any device on your home network and log in with the admin account.

> `ADMIN_USER` / `ADMIN_PASSWORD` are only used while no accounts exist.
> After the first start you manage everything in the game.

## 3. Add players

In the game menu, tap your name (bottom-left) → **Manage players**:

- **Add player**: username + password (tick _Admin_ to make another admin)
- **Reset password**, **Disable / Enable**, **Make admin**, **Remove**

Changes apply immediately — a removed or disabled player is kicked out of
new joins, and a reset password logs out their old sessions. Players can
change their own password from the same menu. Anyone logged in can create
lobbies (**Create Lobby**) and invite others with the link.

From the server shell (e.g. if you forget your password):

```bash
docker compose exec game npx tsx scripts/selfhost-admin.ts list
docker compose exec game npx tsx scripts/selfhost-admin.ts passwd <user> <new-password>
docker compose exec game npx tsx scripts/selfhost-admin.ts add <user> <password> admin
```

Accounts live in `deploy/selfhost/data/accounts.json` (passwords are
hashed with scrypt; never stored in plain text). Back up the `data/`
folder to keep your players.

## 4. Play from anywhere

Pick one:

### Option A — Cloudflare Tunnel (recommended, no router changes)

Free, gives you HTTPS, no ports opened on your home network.

1. Put a domain on Cloudflare (or buy one there), e.g. `example.com`.
2. On the server:
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
   sudo dpkg -i cloudflared.deb
   cloudflared tunnel login
   cloudflared tunnel create laukolaroser
   cloudflared tunnel route dns laukolaroser game.example.com
   cloudflared tunnel run --url http://localhost:8080 laukolaroser
   ```
   (To keep it running: `sudo cloudflared service install` with a config
   file — see Cloudflare's "Run as a service" guide.)
3. Set `DOMAIN=game.example.com` in `.env`, then `docker compose up -d`.
4. Everyone opens **https://game.example.com**.

### Option B — Port forwarding + HTTPS

1. On your router, forward TCP **443** (and 80) to the server.
2. Put a reverse proxy with automatic HTTPS in front, e.g. Caddy:
   ```
   game.example.com {
       reverse_proxy localhost:8080
   }
   ```
3. Point `game.example.com` at your home IP (use a dynamic-DNS service if
   your IP changes). Set `DOMAIN` in `.env`.

WebSockets must be passed through (Caddy and Cloudflare do this by default).

## 5. Install on phones and PCs

- **iPhone/iPad (Safari):** Share → _Add to Home Screen_.
- **Android (Chrome):** menu → _Install app_ / _Add to Home screen_.
- **PC (Chrome/Edge):** the install icon in the address bar.

It then opens full-screen like a normal app and remembers your login for
30 days.

## Updating

```bash
cd laukolaroser && git pull
cd deploy/selfhost && docker compose up -d --build
```

Accounts in `data/` are kept.

## Resource limits

`docker-compose.yml` caps the container at **2 GB RAM / 2 CPUs** and runs
2 game workers with a 320 MB heap each. In testing, the game server used about
210–290 MB of RAM idle in Docker, and about 440 MB (master + 2 workers)
after a two-player game.
The game simulation itself runs on the players' devices, so more players
mostly adds network traffic, not server memory.

## Security notes

- Use strong passwords; failed logins are rate-limited per IP.
- Use HTTPS (Option A or B) when playing over the internet.
- Only admins can add/remove players; the last admin cannot be removed or
  disabled, so you cannot lock yourself out from the UI.
- Self-hosted mode turns off the original online services (store,
  global leaderboard, sign-in providers); everything runs on your server.

## License

Laukolaroser is licensed under the GNU AGPL v3. If you let others play on
your server, the license requires that they can get the source code —
the footer links to the repository.
