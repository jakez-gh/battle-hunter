# Battle Hunter (clone)

A mechanically faithful, from-scratch clone of the 1999 PlayStation tactical RPG
*Battle Hunter* (JP: *Battle Sugoroku: The Hunter*): four hunters compete in a
randomly generated grid dungeon to grab a relic and escape, using dice-based
movement and a 100-card deck.

**All code, art, music, sound, names, and text in this repository are original.**
Game *mechanics* are recreated from publicly documented rules; no assets, story,
characters, or other creative expression from the original game are used.

## Running

Zero dependencies. Either:

```
node tools/serve.mjs        # then open http://localhost:8377
```

or serve the repo root with any static file server. The game is plain ES
modules + Canvas + WebAudio; there is no build step.

## Tests

Engine logic is pure and runs under Node:

```
node --test
```

## Layout

- `index.html`, `style.css`, `src/main.js` — entry point
- `src/engine/` — pure game logic (no DOM): RNG, board generation, cards, combat, turn state machine, AI
- `src/render/` — Canvas renderer and procedurally generated pixel art
- `src/audio/` — WebAudio-synthesized sound effects and music
- `src/ui/` — screens and input handling
- `tests/` — Node test suite for the engine
- `DESIGN.md` — the mechanics spec the implementation follows
