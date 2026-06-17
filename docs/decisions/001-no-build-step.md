# ADR-001: No build step

- **Status:** Accepted
- **Date:** 2026-06-11
- **Level:** architecture

## Question

Should the project use a bundler/transpiler (Vite, esbuild, Webpack, Babel) or
serve ES modules directly as static files?

## Options considered

1. **Bundler (Vite/esbuild)** — modern DX: HMR, tree-shaking, TypeScript, npm
   packages. Adds a build step and node_modules to the dev workflow.

2. **Raw ES modules, no build** — browser-native: `<script type="module">`, static
   file serving, no toolchain. Limits to features supported by target browsers.
   `node --test` works on engine files without any transpilation.

## Decision

Option 2 — no build step.

## Why

The project has zero external runtime dependencies. All assets are hand-authored
(string grids, synthesised audio). The test suite runs directly in Node. Adding a
bundler would introduce accidental complexity — version pinning, config files,
dependency churn — with no payoff.

Serving as static files also makes deployment trivial: any CDN, GitHub Pages, or
`python -m http.server` works.

## Consequences

- Can't use npm packages at runtime (only pure-browser APIs).
- TypeScript requires a separate tsc pass if ever desired.
- `node --test` on engine files is always available and fast (~1 s for 263 tests).
- Deployment: `deploy.sh` / `deploy.bat` handle Pages / Netlify / Vercel.
- Revisit if the project grows to need npm packages (e.g. a multiplayer server).
