---
kind: external_dependency
name: Express web server
slug: express
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### Express
- Role: HTTP server framework powering the mihome-web hub; routes under `src/routes/` (auth, devices, keys, meta, open, profiles) mount onto an Express app.
- Integration point: `src/index.ts` boots the process via `tsx`, `src/app.ts` wires routes and middleware.
- Client build is separate (`client/`) and served as static assets from `public/`; no client-side framework dependency in this repo's manifest beyond Vite tooling.
- Verify exact route wiring against current source.