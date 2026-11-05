---
kind: build_system
name: Node/TypeScript + Vite Dual-Bundle Build
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - client/package.json
    - tsconfig.json
    - client/vite.config.ts
---

## Overview

MiHome Web is a dual-bundle project: a Node.js/Express server (TypeScript, compiled via `tsc`) and a React dashboard (Vite). There are no Makefiles, Dockerfiles, CI pipelines, or release scripts in the repository — the build system is entirely npm scripts plus TypeScript/Vite configuration.

## Server-side build

- Root `package.json` defines the server entry point and scripts:
  - `dev`: `tsx watch src/index.ts` — hot-reloaded development using `tsx` (no precompile).
  - `start`: `tsx src/index.ts` — run directly from source.
  - `build`: `tsc -p tsconfig.json` — compiles `src/**/*.ts` into `dist/` per `tsconfig.json` (`"outDir": "dist"`, `"rootDir": "src"`).
  - `build:client`: delegates to the client bundle via `npm run build --prefix client`.
  - `typecheck`: `tsc -p tsconfig.json --noEmit`.
- `tsconfig.json` enforces strict mode, ES2022 target, `NodeNext` module resolution, source maps, and includes only `src/**/*.ts`. Declarations are disabled (`"declaration": false`).
- Runtime dependencies at the root are minimal: `express` and `busboy`; everything else is dev-only (`tsx`, `typescript`, `@types/*`).

## Client-side build

- `client/package.json` defines:
  - `dev`: `vite` — Vite dev server on port 5173.
  - `build`: `tsc --noEmit && vite build` — type-check then compile assets.
  - `typecheck`: `tsc --noEmit`.
- `client/vite.config.ts` configures:
  - `@vitejs/plugin-react` for JSX support.
  - Dev proxy `/api` → `http://127.0.0.1:8787` so the frontend can call the local Express server during development.
  - Production output goes to `../public` with `emptyOutDir: true`, meaning the built JS/CSS assets land next to the static `index.html` served by the Express app.

## Build flow and conventions

- The two bundles are independent npm workspaces but not formally declared as such; the root script calls the client build via `--prefix client`.
- Development workflow: start the server with `npm run dev` (tsx) and the client separately with `npm run dev` inside `client/` (Vite proxies API calls to the running server).
- Production build sequence implied by the scripts: first `npm run build:client` (writes to `public/`), then `npm run build` (compiles server to `dist/`); the final deployable artifact is the `dist/` directory alongside the prebuilt `public/` assets.
- No containerization, no CI, no versioning strategy, no cross-compilation targets are present in the repository.

## Constraints enforced by tooling

- Server code must be valid TypeScript under `src/` and pass strict compilation (`strict: true` in `tsconfig.json`).
- Client code must pass `tsc --noEmit` before Vite runs its bundler (enforced by the `build` script order in `client/package.json`).
- The client's production build overwrites `public/` completely (`emptyOutDir: true`), so any hand-edited files there will be lost on rebuild.