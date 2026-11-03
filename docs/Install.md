# Install & Play — Windows 11, Linux, macOS, Android, iOS, public PCs

Laukolaroser runs in the browser. One computer runs the **server**; every
player (PC, phone, tablet) just opens the server's address — or the
Android app.

| I want to…                             | Go to                                           |
| -------------------------------------- | ----------------------------------------------- |
| Run the game on my PC (Windows 11)     | [1. Windows 11](#1-windows-11-main-pc)          |
| Run it on Linux / macOS                | [2. Linux](#2-linux), [3. macOS](#3-macos)      |
| Play on my Android phone (APK)         | [4. Android](#4-android-apk-or-browser)         |
| Play on iPhone / iPad                  | [5. iOS](#5-ios-iphone--ipad)                   |
| Play on a school / library / public PC | [6. Public PC](#6-public-pc-nothing-to-install) |
| Host it 24/7 for friends               | [SelfHosting.md](SelfHosting.md)                |

Repository: `https://github.com/lowmentaldamage/school_app_openfront`
(branch `ccr-f2fe3bd8-k0h6kk`). If it is private, sign in to GitHub first.

**Tested automatically** on every push (GitHub Actions _💻 Platforms_):
install, production build, server start + login on **Windows**, **macOS**
and **Linux**; the _📱 Android APK_ workflow builds the app.

---

## 1. Windows 11 (main PC)

Open **PowerShell** (Start → type _PowerShell_) and run, one line at a time:

```powershell
winget install --id Git.Git -e
winget install --id Schniz.fnm -e
```

Close PowerShell, open it again, then:

```powershell
fnm env --use-on-cd | Out-String | Invoke-Expression
fnm install 24
fnm use 24
npm install --global npm@12
node -v     # v24.x
npm -v      # 12.x

cd $HOME
git clone -b ccr-f2fe3bd8-k0h6kk https://github.com/lowmentaldamage/school_app_openfront laukolaroser
cd laukolaroser
npm run inst
npm run dev
```

The game opens at **http://localhost:9000**. Stop with `Ctrl+C`.

To make `fnm` work in every new PowerShell window, run once:
`Add-Content $PROFILE 'fnm env --use-on-cd | Out-String | Invoke-Expression'`.

**Private mode (logins) on Windows:**

```powershell
$env:SELF_HOSTED="1"; $env:SELFHOST_DATA_DIR="$HOME\laukolaroser-data"
$env:SELFHOST_ADMIN_USER="admin"; $env:SELFHOST_ADMIN_PASSWORD="change-me-please"
npm run dev
```

**Play from your phone on the same Wi-Fi:** start with `npm run dev:lan`
instead of `npm run dev`, find your PC's address with `ipconfig` (IPv4,
e.g. `192.168.1.20`) and open `http://192.168.1.20:9000` on the phone.
Allow Node.js through the Windows firewall when asked (_Private networks_).

**Run it as a real server (Docker):** install
`winget install --id Docker.DockerDesktop -e`, start Docker Desktop, then
follow [SelfHosting.md](SelfHosting.md) from step 2 in PowerShell
(`copy .env.example .env`, `notepad .env`, `docker compose up -d --build`).

**Update later:** `cd $HOME\laukolaroser; git pull; npm run inst; npm run dev`

---

## 2. Linux

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24
npm install --global npm@12
sudo apt install -y git        # Fedora: sudo dnf install git

git clone -b ccr-f2fe3bd8-k0h6kk https://github.com/lowmentaldamage/school_app_openfront ~/laukolaroser
cd ~/laukolaroser
npm run inst
npm run dev                    # http://localhost:9000
```

Phone on the same network: `npm run dev:lan`, find the PC address with
`ip -4 addr` and open `http://<that-address>:9000`. Server for friends:
[SelfHosting.md](SelfHosting.md).

---

## 3. macOS

```bash
xcode-select --install                     # git (skip if already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.zshrc
nvm install 24
npm install --global npm@12

git clone -b ccr-f2fe3bd8-k0h6kk https://github.com/lowmentaldamage/school_app_openfront ~/laukolaroser
cd ~/laukolaroser
npm run inst
npm run dev                                # http://localhost:9000
```

Phone on the same Wi-Fi: `npm run dev:lan`, address from
_System Settings → Wi-Fi → Details → IP address_. Docker server: install
Docker Desktop for Mac, then [SelfHosting.md](SelfHosting.md).

---

## 4. Android (APK or browser)

### Option A — the app (APK)

1. On the phone open
   **https://github.com/lowmentaldamage/school_app_openfront/releases/tag/android-latest**
   (sign in to GitHub if the repository is private).
2. Tap **laukolaroser.apk** to download, then open it.
3. Android asks to allow installs from your browser: **Settings → Allow
   from this source**, go back, **Install**.
4. Open **Laukolaroser**, enter your server address:
   - same Wi-Fi as your PC: `http://192.168.1.20:9000` (dev, `npm run dev:lan`)
     or `http://192.168.1.20:8080` (Docker server);
   - over the internet: `https://game.example.com`.
5. Play. Back button → _Reload / Change server / Quit_.

The APK is rebuilt automatically when `android/` changes (workflow
_📱 Android APK_); it is a debug-signed build for testing and personal use,
so Google Play Protect may warn — choose _Install anyway_. Requires
Android 8.0 or newer.

Build it yourself (Android Studio or JDK 17 + Android SDK):
`gradle -p android assembleDebug` → `android/app/build/outputs/apk/debug/app-debug.apk`.

### Option B — install from the browser (no APK)

Open the server address in **Chrome** → menu **⋮** → **Install app** /
**Add to Home screen**. It opens full screen like an app.

---

## 5. iOS (iPhone / iPad)

Apple only allows App Store apps, so on iOS the game installs from Safari:

1. Open the server address in **Safari**.
2. **Share** → **Add to Home Screen** → **Add**.
3. Start it from the home-screen icon (full screen, remembers your login).

Use iOS 16 or newer. For play outside your home network the server needs
an `https://` address ([SelfHosting.md §4](SelfHosting.md)).

---

## 6. Public PC (nothing to install)

On a school, library or friend's computer just open the server address in
any up-to-date browser (Chrome, Edge, Firefox, Safari):

- `https://game.example.com` (your server on the internet), or
- `http://<server-ip>:8080` on the same network.

On a private server log in with your username and password, and **log out
when you finish** (your name, bottom-left of the menu → _Log out_). Nothing
is installed; closing the browser leaves only the remembered login, which
_Log out_ removes. If the PC is slow, add `?renderer=2d` to the address for
the flat map.

---

## Checking it works

| Step                   | Expected                                             |
| ---------------------- | ---------------------------------------------------- |
| `node -v` / `npm -v`   | `v24.x` / `12.x`                                     |
| `npm run inst`         | finishes without errors                              |
| `npm run smoke:server` | `OK: server up on … logged in as smokeadmin`         |
| `npm run dev`          | browser shows the Laukolaroser menu at :9000         |
| Solo → Start Game      | 3D map, pick a spawn, the game runs                  |
| Phone on same Wi-Fi    | menu loads at `http://<pc-ip>:9000` (with `dev:lan`) |

Problems: see [SelfHosting.md §9](SelfHosting.md#9-troubleshooting) and
[PlayerGuide.md §10](PlayerGuide.md#10-problems).
