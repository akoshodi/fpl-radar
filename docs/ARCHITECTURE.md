# Architecture

## Design goal

Zero install friction for other Omarchy users. That drives every decision below: no backend process, no extra package manager, no database server. The plugin is a "bar" kind + an "overlay"/panel kind, per Omarchy's plugin manifest system, and it talks to the internet directly from QML.

```
┌─────────────────────────────┐
│   BarWidget.qml (always on) │  reads → Model.js properties only
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│      Panel.qml (on demand)   │  reads/writes → Model.js
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│         Model.js             │  owns Timers, cache, refresh logic
│  - liveScoreRefresh (30–60s during live GWs)
│  - deadlineCountdown (1s tick, cheap)
│  - priceWatchRefresh (daily)
│  - topManagerAnalysisRefresh (daily, post-deadline)
└──────┬───────────────┬───────┘
       │               │
┌──────▼──────┐  ┌─────▼────────────────┐
│ FplApi.js   │  │ TopManagerAnalysis.js │
│ (fetch/JSON)│  │ (pure aggregation fns)│
└──────┬──────┘  └───────────────────────┘
       │
   FPL public API (fantasy.premierleague.com/api/...)
```

## Why pure QML/JS instead of a backend

The obvious alternative — a small Laravel or Python service polling the FPL API and exposing a local endpoint — is more comfortable to write and easier to unit test. But it means every user installing this plugin also needs PHP or Python installed, a process supervisor (systemd unit, cron, or similar) to keep it running, and a port free on their machine. That's a lot to ask for what is, functionally, "fetch some JSON and cache it."

QML's `XMLHttpRequest` (available in the JS engine Qt Quick embeds) can do the same fetch-and-cache job directly. The trade-off is that heavier computation (aggregating picks across dozens of top managers) has to be written carefully — as pure functions operating on plain JS objects/arrays — since there's no npm ecosystem (lodash, axios, etc.) to lean on. `TopManagerAnalysis.js` is written with that constraint in mind: small, dependency-free helper functions.

## Caching

Two options, both dependency-free:

1. **Plain JSON file** under the plugin's own data directory (Omarchy plugins get a writable per-plugin config/data path). Read on startup, written after each successful fetch. Simplest option — use this by default.
2. **Qt Quick `LocalStorage` module** (`QtQuick.LocalStorage`, SQLite under the hood, ships with Qt — no extra install) if the data model grows past what's comfortable as a flat JSON blob (e.g. storing per-gameweek history for trend charts).

Start with (1). Move to (2) only if a feature genuinely needs querying historical data rather than "the latest snapshot."

Every cached value is stored with a `fetchedAt` timestamp. Consumers compare against the TTLs in `docs/DATA_SOURCES.md` and show a subtle "stale" indicator rather than blocking the UI on a slow/failed request.

## Refresh scheduling

- Bar widget's live-points figure: only actively polled during a live gameweek window (kickoff of first fixture → full-time + bonus confirmation of last fixture). Outside that window, it just shows the last final total — no polling.
- Deadline countdown: local calculation from cached `bootstrap-static` deadline time, ticked with a cheap 1-second `Timer` — no network call needed for the tick itself.
- Price watch / top-manager analysis: both are inherently daily-cadence data (FPL prices update once a day; top managers' picks for a gameweek don't change mid-week). Refresh once daily, ideally scheduled just after the transfer deadline passes so the "current gameweek" picks are final.

## Escape hatch (only if truly needed)

If a future feature needs something QML genuinely can't do well (e.g. heavy historical statistical modeling across seasons), the fallback is an **optional** companion script the user can run separately (e.g. a single dependency-free shell script using `curl` + `jq`, both commonly preinstalled or trivial to install) that writes a JSON file the plugin reads. Keep this optional and clearly separate from the core plugin so the base install still requires nothing extra.
