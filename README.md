# FPL Companion — Omarchy Plugin

A Fantasy Premier League (FPL) companion plugin for [Omarchy](https://omarchy.org). Gives you a bar widget for live gameweek points and deadline countdowns, plus a panel for transfer planning, captain picks, price-change alerts, and squad news — without asking you to install a backend runtime.

This repo is set up to be built primarily with an AI coding agent (Claude Code, Cursor, etc.). See [`AGENTS.md`](./AGENTS.md) for the rules the agent should follow, and [`docs/`](./docs) for architecture and data-source details.

## Features

- **Live gameweek points** — bar widget ticks up as your 15 players score, assist, and pick up bonus points.
- **Deadline guard** — countdown that changes color as the transfer deadline approaches (amber → red).
- **Price-change watch** — flags players trending to rise/fall based on ownership deltas.
- **Squad news** — surfaces injury/press-conference flags for your players (from FPL's own status fields).
- **Chip tracker** — reminds you which chips (Wildcard, Bench Boost, Free Hit, Triple Captain) are unused.
- **Transfer & captain suggestions from top managers** — analyzes the weekly selections of the highest-ranked FPL managers and surfaces captaincy consensus and differential transfer targets. See [`docs/ROADMAP.md`](./docs/ROADMAP.md#transfer--captain-suggestions-from-top-managers) for the methodology.

## Why this stack

Omarchy plugins run inside a Qt/QML runtime that's already part of the shell — nothing extra to install. This plugin is deliberately **pure QML + JavaScript**, calling the public FPL API directly with QML's built-in `XMLHttpRequest` and caching responses to a local JSON file with the `LocalStorage`/file APIs that ship with Qt Quick.

No Node, Python, PHP, or database server required. A user installs this the same way they'd install any other Omarchy plugin — clone, enable, done. That matters if you want other Omarchy users to actually pick it up: every extra runtime dependency is a reason someone bounces off the install step.

If you outgrow pure QML (e.g. you want heavier historical analysis than a phone-sized JSON cache can hold), see the "Escape hatch" note in `docs/ARCHITECTURE.md` — but treat that as a last resort, not the default plan.

## Installation

```bash
omarchy plugin add https://github.com/<your-username>/fpl-omarchy-plugin.git --enable --yes
```

Or for local development, clone a copy under your Omarchy config and let the plugin manager discover it:

```bash
omarchy plugin clone <this-repo-url> yourname.fpl
# edit files under ~/.config/omarchy/plugins/yourname.fpl/
omarchy-shell shell rescanPlugins   # force discovery if it doesn't hot-reload
```

## Configuration

Set your Team ID in either of two ways (panel edits win if both are set):

1. **Panel (recommended)** — open the panel, type your Team ID, League ID, and top-N sample, then Save & refresh.
2. **Bar config** — `omarchy plugin enable` supports a settings schema (`entryId`, `leagueId`, `topManagerSampleSize`), so the ID can also live in `~/.config/omarchy/shell.json`.

- **FPL Team/Entry ID** — found in the URL when you view your team on the FPL site (`fantasy.premierleague.com/entry/<ID>/...`).
- **League ID for top-manager analysis** *(optional)* — defaults to the global "Overall" league (`314`). Point it at a mini-league if you'd rather benchmark against your own group instead of the world's best.

Settings are stored locally via the plugin's own config file — nothing is sent anywhere except the public FPL API.

## Project layout

```
fpl-omarchy-plugin/
├── AGENTS.md              # rules for AI coding agents working in this repo
├── manifest.json          # Omarchy plugin manifest
├── docs/
│   ├── ARCHITECTURE.md    # how the pieces fit together, caching strategy
│   ├── DATA_SOURCES.md    # FPL API endpoints used, rate limits, TTLs
│   └── ROADMAP.md         # feature phases, incl. top-manager analysis methodology
└── src/
    ├── BarWidget.qml      # always-visible bar widget
    ├── Panel.qml          # expanded panel (transfers, captain, chips, news)
    ├── Model.js           # shared state, caching, refresh scheduling
    └── lib/
        ├── FplApi.js              # thin wrapper over the public FPL endpoints
        └── TopManagerAnalysis.js  # captaincy/differential analysis over sampled top managers
```

## Status

- Phase 1 done: bar widget with live gameweek points + deadline countdown (`src/Model.js`, `src/BarWidget.qml`).
- Phase 2 done: panel basics — settings (Team ID / League ID / top-N sample), squad news flags, chip tracker (`src/Panel.qml`, `src/Model.js`, `src/lib/FplApi.js`).
- Next: Phase 3 price watch, then Phase 4 top-manager analysis — see [`docs/ROADMAP.md`](./docs/ROADMAP.md).

## License

MIT — see `LICENSE`.
