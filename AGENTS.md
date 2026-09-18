# AGENTS.md

Instructions for any AI coding agent (Claude Code, Cursor, Copilot Workspace, etc.) working in this repository. Read this before writing code. If a request conflicts with this file, follow this file and flag the conflict to the human.

## Project in one sentence

An Omarchy plugin (bar widget + panel) that surfaces live FPL points, deadlines, price alerts, squad news, and transfer/captain suggestions derived from top-ranked managers' selections — built with zero runtime dependencies beyond Omarchy's bundled Qt/QML engine.

## Hard constraints — do not violate

1. **No new runtime dependencies.** No Node.js, Python, PHP, Ruby, Docker, or database server. Everything runs inside the QML/JS environment Omarchy already provides. If a feature seems to need one, stop and propose the idea to the human rather than adding it — see "Escape hatch" in `docs/ARCHITECTURE.md`.
2. **No npm/pip packages.** QML's built-in `XMLHttpRequest`, `Qt.labs.settings`, and the Qt Quick `LocalStorage` module (or a plain JSON file under the plugin's config directory) are the only persistence/networking tools to reach for.
3. **Respect the FPL API.** It's public and unauthenticated, but not officially documented or SLA'd. Always cache; never poll faster than the intervals in `docs/DATA_SOURCES.md`; never fan out more than the sampling limits defined in `TopManagerAnalysis.js` when pulling top-manager picks (this endpoint is per-manager, so naive loops over thousands of entries will hammer FPL's servers and get you rate-limited or blocked).
4. **Manifest stays valid.** Any new entry point or capability added to `src/` must be reflected in `manifest.json`. Run `omarchy plugin validate` (or note that it should be run) after manifest changes.
5. **Keep the bar widget cheap.** It's rendered constantly. Expensive computation (top-manager analysis, price-trend calculation) belongs in `Model.js`/`TopManagerAnalysis.js`, computed on a timer, and only the *result* should be bound into `BarWidget.qml`.

## File responsibilities

| File | Responsibility |
|---|---|
| `src/BarWidget.qml` | Minimal, always-on display: live points, deadline countdown. No network calls directly. |
| `src/Panel.qml` | Expanded view: transfers, captain suggestions, price watch, news, chip tracker. Reads from `Model.js`. |
| `src/Model.js` | Single source of truth. Owns refresh timers, caching, and exposes plain properties/signals the QML files bind to. |
| `src/lib/FplApi.js` | Thin fetch wrapper for FPL endpoints listed in `docs/DATA_SOURCES.md`. No business logic here — just requests and JSON parsing. |
| `src/lib/TopManagerAnalysis.js` | Implements the methodology in `docs/ROADMAP.md#transfer--captain-suggestions-from-top-managers`. Pure functions where possible: given raw picks data in, ranked suggestions out — easy to unit-test by hand with fixture JSON. |

## Coding conventions

- QML: one component per file, PascalCase filenames matching the root element name.
- JS: plain ES5/ES6-ish subject to QML's JS engine constraints — avoid assuming Node-only globals (`require`, `process`, `Buffer` don't exist here).
- All network calls go through `FplApi.js`. Don't inline `XMLHttpRequest` calls elsewhere.
- All FPL API responses get cached with a timestamp; every consumer checks cache freshness against the TTLs in `docs/DATA_SOURCES.md` before refetching.
- Prefer small, pure functions in `lib/` files over logic embedded in QML `Component.onCompleted` blocks — easier for a future agent (or human) to reason about and test.

## Definition of done, per feature

A feature from `docs/ROADMAP.md` is done when:

1. It has a clear data source in `docs/DATA_SOURCES.md` (add one if missing).
2. Logic lives in `Model.js` or a `lib/` module, not directly in QML.
3. It degrades gracefully offline/on API failure (show cached/stale data with a visible "stale" indicator, never a crash or blank panel).
4. It respects the refresh-interval and sampling limits already documented.
5. README's feature list and `manifest.json` (if a new entry point/kind is added) are updated in the same change.

## Testing approach

There's no CI/test runner here by design (would add dependencies). Validate manually:

- `omarchy plugin validate` after manifest edits.
- `omarchy-shell shell rescanPlugins` to force a reload during development.
- For `lib/` logic, write throwaway fixture JSON (sample API responses) and log outputs to the console rather than adding a test framework.

## Open questions to surface to the human, not decide unilaterally

- Whether to widen the top-manager sample size beyond the default (trade-off: accuracy vs. API load).
- Any change that would require a dependency outside Qt/QML.
- Whether analysis results should ever be shared/exported outside the local machine.
