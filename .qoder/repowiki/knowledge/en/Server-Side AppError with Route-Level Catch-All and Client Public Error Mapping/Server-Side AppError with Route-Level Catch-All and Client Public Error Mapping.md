---
kind: error_handling
name: Server-Side AppError with Route-Level Catch-All and Client Public Error Mapping
category: error_handling
scope:
    - '**'
source_files:
    - src/core/errors.ts
    - src/app.ts
    - src/routes/auth.ts
    - src/routes/devices.ts
    - src/routes/meta.ts
    - src/providers/demo/index.ts
    - src/providers/midea/api.ts
    - src/providers/midea/auth.ts
    - src/controls/panel.ts
    - client/src/utils/api.ts
---

## Approach

MiHome Web uses a custom `AppError` class as the single server-side error type, combined with route-level try/catch blocks that convert thrown errors into JSON responses via a shared `toPublicError` helper. There is no global Express error-handling middleware; each router module handles its own errors.

## Core Types (`src/core/errors.ts`)

- `AppError extends Error` — carries three fields: `code` (string/number), `status` (HTTP status number), and optional `details?: Record<string, unknown>` which is merged into the response body.
- `isAuthFailure(error)` — detects whether an error represents a login/session-expired condition by matching either `AppError.code` / `AppError.status` against a hardcoded set `{"AUTH", "401", "403"}` or by regex-matching common auth-related substrings in the message. Used to decide when to redirect the client to re-login.
- `toPublicError(error)` — sanitizes any thrown value into a plain object `{ error, code, ...details }`. For `AppError`, it forwards `message`, `code`, and spreads `details`; for other `Error`s it falls back to `error.message || "请求失败"` and strips internal properties; for non-Error values it returns `{ error: "请求失败", code: "" }`.

## Conventions Observed

1. **Throw `AppError` from business logic.** Vendor providers, control profiles, and core modules throw `AppError` with a short string code and an explicit HTTP status:
   - Auth/validation failures use `"AUTH"` with status `400` (e.g. missing phone/password).
   - Missing resources use `"DEVICE"` / `"404"` with status `404`.
   - Unsupported features use `"UNSUPPORTED"` with status `501`.
   - External vendor HTTP failures are mapped to `502` (see `providers/midea/api.ts`).
   - Control-panel rule violations use `"PROP"` with status `400`.

2. **Route handlers wrap calls in try/catch.** Every route handler in `src/routes/auth.ts`, `src/routes/devices.ts`, and `src/routes/meta.ts` follows the pattern:
   ```ts
   try { /* call provider */ }
   catch (error) {
     res.status(error instanceof AppError ? error.status : <fallback>).json(toPublicError(error));
   }
   ```
   The fallback status varies by route: `400` for meta/auth, `502` for device operations.

3. **No global error middleware.** `src/app.ts` registers only JSON parsing, routers, and static file serving. Unhandled exceptions will propagate to Node's default uncaught-exception behavior rather than being converted to JSON.

4. **Client-side error presentation lives in `client/src/utils/present.ts`** (referenced by the component layer). The client API helpers in `client/src/utils/api.ts` parse JSON safely (`.catch(() => ({}))`) and throw `new Error(data.error || "请求失败")` when `response.ok` is false, so the React UI treats all non-2xx responses uniformly.

5. **Auth-failure detection is centralized.** Callers of `isAuthFailure` (in session/status probing) can distinguish between transient network/vendor errors and genuine credential expiration, triggering a re-login flow instead of surfacing a raw error to the user.

## Constraints Enforced by Code

- Only `AppError` instances carry structured `code`/`status`/`details`; arbitrary `Error` objects are downgraded to a generic `{ error, code }` shape by `toPublicError`, preventing internal stack traces or private fields from leaking to the client.
- The `details` field on `AppError` is intentionally typed as `Record<string, unknown>` and spread into the response, so callers must keep it serializable and safe for JSON serialization.
- The auth-failure heuristic is conservative: it matches both exact codes and a broad Chinese/English keyword list, so new auth-related error messages are likely to be auto-detected without changing code.