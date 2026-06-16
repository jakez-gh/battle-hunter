# How to Share Battle Hunter with Friends

## Option 1 — Zip and send (easiest, they need Node.js)

1. Zip this entire folder.
2. Send the zip file (email, Google Drive, Discord, USB stick — anything works).
3. Tell your friend to:
   - Install [Node.js](https://nodejs.org) if they don't have it (free, ~30 MB).
   - Unzip the folder.
   - On **Windows**: double-click `run.bat`.
   - On **Mac/Linux**: open a terminal in the folder and run `bash run.sh`.
   - The game opens at `http://localhost:8377` in their default browser.

> **Note:** double-clicking `index.html` directly will not work — browsers block ES
> modules loaded from the filesystem. The local server in `run.bat` / `run.sh`
> is required.

## Option 2 — GitHub Pages (free hosting, no Node.js required for players)

This puts the game on a public URL anyone can open without installing anything.

1. Push this repo to GitHub (if you haven't already).
2. Go to your repo on GitHub → **Settings** → **Pages**.
3. Under *Source*, choose **Deploy from a branch**, select `master` (or `main`),
   folder `/` (root), and click **Save**.
4. After a minute or two, GitHub gives you a URL like
   `https://your-username.github.io/battle-hunter/`.
5. Share that URL. Done.

## Option 3 — Any static file host

Because there is no build step, any host that serves static files works:

| Host | How |
|------|-----|
| **Netlify** | Drag the project folder onto [app.netlify.com/drop](https://app.netlify.com/drop). |
| **Vercel** | `npx vercel` in the project root; follow the prompts. |
| **itch.io** | Upload a zip of the folder as an HTML5 game, enable *SharedArrayBuffer* if prompted. |

All of these are free for a project this size and give you a shareable URL.

## LAN / same Wi-Fi (quick multiplayer session)

If you and your friends are on the same network:

1. Run `run.bat` or `run.sh` on one machine.
2. Find that machine's local IP (e.g. `192.168.1.42`).
3. Friends open `http://192.168.1.42:8377` in their browser.

The game supports 2–4 players at one keyboard, so this is mostly useful for
spectating or playing on separate monitors connected to the host machine.
