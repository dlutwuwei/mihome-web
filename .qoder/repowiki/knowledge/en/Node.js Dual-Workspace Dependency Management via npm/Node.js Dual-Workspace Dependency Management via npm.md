---
kind: dependency_management
name: Node.js Dual-Workspace Dependency Management via npm
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - client/package.json
    - .gitignore
---

## Approach

MiHome Web is a Node/TypeScript project organized as two npm workspaces under one repository: a server package at the repo root and a client package under `client/`. Each workspace has its own `package.json`, its own dependency graph, and its own lockfile. Dependencies are managed with **npm** (no yarn/pnpm/bun usage observed).

There is no vendoring of third-party packages — all dependencies are resolved from the public npm registry at install time. No private registries, `.npmrc` files, or environment variables such as `NPM_CONFIG_REGISTRY` appear in the repository.

## Key Files

- `package.json` (root) — declares the server-side runtime (`express`, `busboy`) and build/dev tooling (`typescript`, `tsx`, `@types/*`).
- `client/package.json` — declares the React dashboard runtime (`react`, `react-dom`) and Vite toolchain (`vite`, `@vitejs/plugin-react`, `typescript`).
- `package-lock.json` (root) — present but explicitly ignored by `.gitignore`.
- `client/package-lock.json` — present but also ignored by `.gitignore`.
- `.gitignore` — excludes `node_modules`, `data`, and both `package-lock.json` files.
- `tsconfig.json` (root) and `client/tsconfig.json` — TypeScript configuration shared between the two workspaces; types for Express/Busboy live alongside their runtime deps in the root workspace.

## Architecture and Conventions

1. **Two independent npm graphs.** The root workspace depends only on `express` and `busboy`; the client workspace depends only on `react`/`react-dom` plus Vite tooling. There is no cross-workspace dependency declaration — the client is built separately via `npm run build --prefix client` (invoked from the root `build:client` script).

2. **Runtime vs devDependency split.** Runtime libraries go under `dependencies`; type definitions (`@types/*`), compilers (`typescript`), and development servers (`tsx`, `vite`) go under `devDependencies`. This keeps production installs lean.

3. **Loose version ranges.** All versions use the caret (`^`) range operator (e.g. `"express": "^4.21.2"`, `"react": "^18.3.1"`, `"typescript": "^5.7.2"`), allowing minor/patch updates to resolve automatically. No fixed pinning is used in manifests.

4. **Lockfiles are generated but not committed.** Both `package-lock.json` files exist locally and are listed in `.gitignore`, so dependency resolution is not reproducible across machines from source alone — each developer's `node_modules` tree is local-only.

5. **No private registry or auth configuration.** No `.npmrc`, no `NPM_CONFIG_*` env vars, and no references to internal registries were found. All packages come from the default public npm registry.

6. **Build scripts orchestrate the dual workspace.** Root scripts:
   - `dev`: runs the server via `tsx watch src/index.ts`
   - `start`: runs the server via `tsx src/index.ts`
   - `build`: compiles server TS via `tsc -p tsconfig.json`
   - `build:client`: delegates to `npm run build --prefix client`
   - `typecheck`: runs `tsc -p tsconfig.json --noEmit`

   Client scripts:
   - `dev`: `vite`
   - `build`: `tsc --noEmit && vite build`
   - `typecheck`: `tsc --noEmit`

## Constraints Observed

- Lockfiles are intentionally excluded from version control (`.gitignore` lists `package-lock.json`), so exact dependency trees are not tracked in the repository.
- Only the public npm registry is used; there is no evidence of scoped/private packages or custom registry configuration.
- Version ranges are uniformly loose (`^`), meaning upgrades are automatic rather than pinned.