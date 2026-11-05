---
kind: configuration_system
name: Environment-Driven Configuration with JSON Profile Overrides
category: configuration_system
scope:
    - '**'
source_files:
    - src/index.ts
    - src/controls/profiles.ts
    - README.md
---

## Approach

MiHome Web uses a minimal, environment-variable-driven configuration system with no dedicated config library (no `dotenv`, no YAML/TOML loader). Runtime settings come from Node's `process.env`, and user-editable device-control profiles are persisted as plain JSON files on disk.

## Key Files

- `src/index.ts` — application bootstrap; reads `PORT` and `HOST` env vars to bind the Express server.
- `src/controls/profiles.ts` — loads runtime device-control profiles from a configurable directory (`MIHOME_PROFILE_DIR`, defaulting to `data/profiles`).
- `README.md` — documents the two configuration surfaces.

## Environment Variables

Three variables are consumed directly via `process.env`:

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `8787` | HTTP listen port (`Number(process.env.PORT || 8787)`) |
| `HOST` | `127.0.0.1` | HTTP listen host |
| `MIHOME_PROFILE_DIR` | `data/profiles` (resolved relative to CWD) | Directory scanned for runtime device-control profile JSON files |

There is no `.env` file loading step — values must be supplied by the process environment at startup.

## File-Based Profiles

Profiles are layered JSON documents read from `data/profiles/<vendor>/<id>.json` (or whatever `MIHOME_PROFILE_DIR` points to):

- The directory tree is walked recursively; every `.json` file is parsed.
- Each file may contain a single `DeviceProfile` or an array of them.
- A minimal validation requires `profile.vendor` and `profile.id` to be strings; malformed entries are silently skipped so one bad file cannot break device discovery.
- Profiles are cached in memory keyed by a filesystem stamp (`stampOf` walks all files and concatenates `path:mtimeMs` pairs); cache is invalidated when any file changes or when `saveProfile()` writes a new profile.
- Profiles can also be registered programmatically at runtime via `registerProfiles(profiles)` (used by vendor providers).

## Layering / Precedence

Profiles follow a four-tier specificity model defined by the `TIER` constant:

1. Vendor default (`vendor` tier = 10)
2. Capability match (`specType` tier = 20)
3. Model match (`model` tier = 30)
4. Device-specific (`did` tier = 40)

Within each tier, exact matches rank higher than wildcard patterns, and `omit` rules get an extra boost so they act as hard exclusions that can only be overridden by a higher tier. Builtin profiles (registered via `registerProfiles`) are evaluated before runtime-loaded profiles.

## Conventions Observed

- All configuration is read lazily at startup time; there is no centralized config object or schema validator.
- Defaults are provided inline next to each `process.env` access rather than in a separate defaults module.
- User data (profiles) lives under `data/` and is written/read synchronously via `fs`; async fs is not used.
- There is no secrets management, encryption, or secret rotation logic in this repo — credentials are handled per-vendor provider modules (e.g. `src/providers/xiaomi/auth.ts`, `src/providers/midea/auth.ts`) and are not surfaced through the shared configuration surface.
- No feature flags or toggle system exists beyond the profile layering mechanism.