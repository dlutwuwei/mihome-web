---
kind: logging_system
name: Logging System — Ad-hoc console.log/console.error Usage
category: logging_system
scope:
    - '**'
source_files:
    - package.json
    - src/index.ts
    - src/core/apikey.ts
    - src/core/session.ts
    - src/providers/pantum/cloud.ts
    - src/routes/devices.ts
---

## What system/approach is used

The repository has **no dedicated logging framework or logger abstraction**. There are no dependencies on pino, winston, bunyan, debug, or any other structured-logging library in `package.json`. All server-side output goes through Node's built-in `console.log` / `console.error` directly.

## Key files and packages

- `src/index.ts` — bootstraps Express and prints the startup URL via `console.log`.
- `src/core/apikey.ts` — uses `console.error` when saving an API key fails.
- `src/core/session.ts` — uses `console.error` when persisting a login session fails.
- `src/providers/pantum/cloud.ts` — dumps HTTP request/response details (`method`, `path`, `status`, truncated body) via `console.error` with a `[print] cloud` prefix.
- `src/routes/devices.ts` — logs print-device errors (filename + stack/message) via `console.error` with a `[print]` prefix.

No client-side logging was found; the React dashboard (`client/src/`) contains no `console.*` calls.

## Architecture and conventions

- **No central logger module**: there is no `logger.ts`, `log.ts`, or similar utility that modules import for emitting log lines.
- **Direct stdio calls**: every log statement is a bare `console.log` or `console.error` call at the call site.
- **Prefix-based categorization**: error messages use bracketed prefixes such as `[print]` and `[print] cloud` to distinguish subsystems in plain-text output.
- **Error payloads**: when logging failures, the code typically checks `error instanceof Error` and emits either `error.message` or `error.stack || error.message`; otherwise it falls back to a stringified value. This pattern appears in `src/core/apikey.ts`, `src/core/session.ts`, and `src/routes/devices.ts`.
- **Truncation of sensitive/bulk data**: long response bodies are sliced (e.g. `text.slice(0, 2000)`, `raw.slice(0, 2000)`) before being logged.

## Conventions and constraints

- **Observed convention** (not enforced by tooling): log statements are written inline with `console.log` / `console.error` rather than through a shared logger function.
- **Observed convention**: error logs include a bracketed subsystem prefix (e.g. `[print]`, `[print] cloud`) to aid manual inspection of stdout/stderr.
- **Observed convention**: when logging an `Error`, the message is extracted via `error instanceof Error ? error.message : ...` (or `error.stack || error.message`) to avoid dumping the full object.
- **Constraint from dependency manifest**: only `express` and `busboy` are runtime dependencies; no logging library is declared, so adding one would require an explicit dependency change in `package.json`.
- **No log-level configuration**: because there is no logger framework, there is no mechanism to adjust verbosity, filter by level, or route logs to different sinks.
- **No structured fields**: all logs are plain strings; there is no JSON/logfmt envelope, timestamp, correlation ID, or field-based structure.