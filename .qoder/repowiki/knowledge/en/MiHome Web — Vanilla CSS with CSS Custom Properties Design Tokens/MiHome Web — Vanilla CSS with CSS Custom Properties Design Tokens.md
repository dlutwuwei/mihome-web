---
kind: frontend_style
name: MiHome Web — Vanilla CSS with CSS Custom Properties Design Tokens
category: frontend_style
scope:
    - '**'
source_files:
    - client/src/styles.css
    - client/vite.config.js
    - client/package.json
    - client/src/components/DevicePanel.tsx
    - client/src/components/PropRow.tsx
---

## Approach

The MiHome dashboard is a React + Vite SPA whose styling is implemented entirely in vanilla CSS. There is no component library, no CSS-in-JS runtime, no preprocessors (SCSS/Less), and no utility framework (Tailwind). The single stylesheet `client/src/styles.css` (~480 lines) defines the entire visual language.

Vite is configured via `client/vite.config.js` to use the `@vitejs/plugin-react` plugin; it has no CSS-related plugins beyond what Vite provides out of the box. Styles are imported once from `main.tsx` and consumed by all components through plain `className` strings.

## Design tokens

All colors, fonts, and spacing are centralized as CSS custom properties on `:root` in `styles.css`:

- **Colors**: `--bg`, `--side`, `--paper`, `--ink`, `--secondary`, `--tertiary`, `--line`, `--sage`, `--copper`, `--danger`.
- **Typography**: `--serif` (`"Songti SC", "Noto Serif SC", "STSong", serif`) for headings/figures, `--sans` (`"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif`) for body text.
- **Color semantics**: `--sage` = success/online, `--danger` = error/expired, `--copper` = warning/unknown state.
- **Global defaults**: `color-scheme: light`, `box-sizing: border-box`, inherited font family and color on `body`.

These variables are the sole source of truth for the palette; components never hard-code hex colors except for neutral track backgrounds like `#ddd4c8` used inside range-slider pseudo-elements.

## Component-style conventions

Styles follow a flat BEM-like class naming scheme without nesting or modules:

- Block-level layout classes: `.app`, `.side`, `.main`, `.login`, `.card`, `.sheet`, `.mask`, `.panel`, `.keys`.
- Shared UI primitives: `.primary`, `.cancel`, `.send`, `.action`, `.switch`, `.seg`, `.slider`, `.number`, `.chips`, `.text`, `.err`, `.hint`, `.brand`, `.kicker`, `.label`, `.figure`, `.facts`, `.row`, `.sec`, `.run-card`, `.sensor`.
- State modifiers applied via string concatenation in JSX (e.g. `className={closing ? "panel leave" : "panel"}`, `className={sameValue(item.value, prop.value) ? "on" : ""}`, `className={prop.value ? "switch on" : "switch"}`).
- Components compose these primitives rather than defining per-component style blocks — e.g., `DevicePanel.tsx` uses `.panel`, `.panel-head`, `.svc`, `.row`, `.print-sheet`, `.card`; `PropRow.tsx` uses `.switch`, `.seg`, `.slider`, `.number`.

There is no CSS scoping mechanism (no CSS Modules, no Shadow DOM, no scoped styles); class names must be globally unique enough to avoid collisions across components.

## Responsive strategy

A single breakpoint at `800px` in `styles.css` switches the two-column `.app` grid to a single column, makes `.side` static-positioned, reduces padding, and collapses the offline grid:

```css
@media (max-width: 800px) {
  .app { grid-template-columns: 1fr; }
  .side { position: static; height: auto; }
  .main { padding: 24px 16px 32px; }
  .offline { grid-template-columns: 1fr; }
  .figure { font-size: 56px; }
}
```

Grid layouts elsewhere rely on `grid-template-columns: repeat(auto-fit, minmax(...))` (`.run`, `.sensors`) so they adapt without extra media queries.

## Motion & accessibility

- Animations are defined as `@keyframes` (`fade-in`, `fade-out`, `panel-in`, `panel-out`, `sheet-in`, `card-in`, `row-in`) and attached to overlay/panel transitions.
- A `prefers-reduced-motion: reduce` block disables all animations and transitions for users who prefer reduced motion.
- Panel dialogs include `role="dialog"`, `aria-modal="true"`, and `aria-label` set to the device name.

## Build output

`vite.config.js` builds the client into `../public` (the repo root's `public/` directory) with hashed filenames (`index-B7TXxhyf.css`, `index-ZdfWXXyD.js`). The server serves this built output as static assets.

## Conventions observed

- All visual values flow through CSS custom properties on `:root`; component files contain zero inline styles.
- Class names are flat, descriptive, and shared across components rather than colocated with components.
- Active/selected states are expressed via an `.on` modifier class toggled in JSX.
- Typography distinguishes display (serif) from body (sans-serif) using the two font families declared as design tokens.
- Color semantics are consistent: sage = good/online, danger = bad/expired, copper = unknown/warning.
- No dark mode, theme switcher, or alternate token set exists — `color-scheme: light` is fixed.