# Play Battle Hunter on Android (phone / tablet)

The game is now touch-playable: a **tap is a click**, so tap a tile to move/steer,
tap menu options, tap to time the dodge/brace minigame, and tap the **❚❚ button
(top-left)** to pause / return to the hub. Pinch-zoom and scroll are disabled on
the game surface so your taps and swipes always reach the game.

Best experience: **hold the phone in landscape** (the board is 4:3, so landscape
fills the screen). Use **QUICK START** on the title screen to jump straight into a
run.

## Fastest way — play over your home Wi-Fi (no upload, ~1 minute)

Your phone and PC must be on the **same Wi-Fi network**.

1. On the PC, start the server:
   ```bash
   node tools/serve.mjs
   ```
   It prints something like:
   ```
   battle-hunter dev server:
     on this PC:   http://localhost:8377
     on your phone (same Wi-Fi): http://192.168.1.42:8377  http://172.20.0.5:8377
   ```
2. On your Android phone's browser (Chrome), type the **`on your phone`** URL —
   pick the one that matches your Wi-Fi (usually `192.168.x.x` or `10.x.x.x`). If
   one doesn't load, try the next.
3. Play. Saves are stored in that browser, per URL.

If none of the addresses load, the PC's firewall may be blocking the port — allow
Node.js / port 8377 on your private network, or see "Permanent" below.

### Add it to your home screen (fullscreen, app-like)

In Chrome on the URL above: **⋮ menu → Add to Home screen**. It launches
fullscreen (no browser bars) in landscape, thanks to the bundled
`manifest.webmanifest` + icon. (Note: a LAN address can change when your router
re-assigns IPs; if the shortcut stops working, re-add it, or use a permanent host.)

## Permanent / shareable — host it

The build is a static site (`index.html`, `style.css`, `src/`, plus
`manifest.webmanifest` and `icon.svg`). Upload that set anywhere static and open
the URL on your phone:

- **itch.io** (HTML game) — the intended distribution + demo funnel. Use
  `deploy.*`; set viewport 960×720, "played in the browser". Works great on mobile.
- **GitHub Pages / Netlify / any static host** — drop the files, open the URL.

A hosted HTTPS URL also makes it a proper installable PWA (stable home-screen app).

## On-screen controls (left edge)

A small touch toolbar gives every desktop-key action a button — validated on an
emulated Galaxy A15:

- **❚❚ pause** — open the pause menu (Resume / Return to Hub). The Esc equivalent.
- **N× speed** — tap to cycle how fast the AI turns animate (the `[` `]` keys).
- **i info** — cycle which hunter the INFO panel reads out (the `Tab` key).
- **↶ undo** — appears while steering; take back your last step (the `Z` key).

Everything else is tap-driven: tap a tile to move/steer, tap a tile you're on (or
the path end) to stop, tap menu options, and tap to time the dodge/brace minigame.

## Known mobile limitations (small, non-blocking)

- Text is sized for a 960×720 canvas; on a small phone some hub/manual text is
  dense. Landscape + the browser's zoom (page, not the game) helps if needed.
