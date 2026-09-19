# FPL Radar

Live Fantasy Premier League insight in your Omarchy bar: a pill with your
gameweek points and the transfer-deadline countdown, and a panel with
settings, squad news, chip tracking, price watch, and top-manager-based
transfer/captain suggestions. Pure QML + JavaScript — no backend runtime,
no extra dependencies. Data comes from the public FPL API and is cached
locally; only the FPL API is ever contacted.

## Install

```bash
omarchy plugin add https://github.com/akoshodi/fpl-radar.git --enable --yes
omarchy-shell shell rescanPlugins
```

Update later with:

```bash
omarchy plugin update akoshodi.fplradar --yes
omarchy-shell shell rescanPlugins
```

## Bar pill

- **Live gameweek points** — ticks up as your players score (`GW7 Live: 62 pts` while a gameweek is live, `GW7: 62 pts` otherwise).
- **Deadline guard** — countdown to the next transfer deadline (`GW8: 1d 4h 12m`), amber under 3 hours, red under 30 minutes.
- Shows `Set FPL ID in panel` until a Team ID is configured, and appends `(stale)` instead of going blank when offline or the API fails.

Left-click opens the panel, middle-click refreshes. The pill only fetches
when a cache TTL is stale — the live score at most once a minute, and only
while a gameweek is actually live.

## Panel

- **Settings** — Team ID, League ID, and top-N sample size, saved back to the widget's `shell.json` entry.
- **Squad News** — injury/doubt/suspension flags for your 15, with captain/vice/bench markers and chance-of-playing % where FPL reports it. Says "All clear" when there is nothing to flag.
- **Chips** — which of Wildcard, Free Hit, Bench Boost, Triple Captain are still available and which gameweek each used one went in.
- **Price Watch** *(Phase 3)* — day-over-day price/transfer-delta risers and fallers.
- **Top Manager Insights** *(Phase 4)* — what the sampled top managers are doing this gameweek: consensus captains, elite differentials (transfer-in candidates), and elites fading (transfer-out candidates among your players). Descriptive signal, not advice — percentages, not a synthetic score.

Click a section's Save & refresh after changing settings. `Esc` closes,
`Tab` moves to the neighboring bar panel.

## Settings

Settings live in the widget's entry in `~/.config/omarchy/shell.json` and
can also be edited in the panel (panel edits win). The top-level keys can
be set with `omarchy bar set akoshodi.fplradar <key> <value>`:

| Key | Default | What it does |
|---|---|---|
| `entryId` | — | Your FPL Team ID, from `fantasy.premierleague.com/entry/<ID>/...` |
| `leagueId` | `314` | League for top-manager analysis (`314` = global Overall; point at a mini-league to benchmark your own group) |
| `topManagerSampleSize` | `50` | How many top managers to sample (capped at 200 to avoid hammering the FPL API) |

Numbers need `--json`, or they land in `shell.json` as strings:

```bash
omarchy bar set akoshodi.fplradar entryId 123456 --json
omarchy bar set akoshodi.fplradar leagueId 314 --json
omarchy bar set akoshodi.fplradar topManagerSampleSize 50 --json
```

## Data

All data comes from the public, unauthenticated FPL API
(`https://fantasy.premierleague.com/api/`), cached locally with a
`fetchedAt` timestamp per endpoint:

| Endpoint | Used for | Refreshes at most |
|---|---|---|
| `/bootstrap-static/` | Players, deadlines, ownership, prices | Every 6 hours |
| `/entry/{id}/event/{gw}/picks/` | Your squad + confirmed points | Every hour |
| `/event/{gw}/live/` | Live bonus/points ticker | Every 60s, only while a gameweek is live |
| `/entry/{id}/history/` | Chip usage | Every hour |

Top-manager picks (Phase 4) are throttled — one request every few hundred
milliseconds, cached for the day — never fanned out concurrently. Anything
that fails keeps the last cached value with a visible stale marker rather
than retrying in a loop.

## Status

Phases 1 (bar widget), 2 (settings, squad news, chips), and 3 (price watch)
are done. Next: Phase 4 top-manager analysis — see
[`docs/ROADMAP.md`](./docs/ROADMAP.md). Notes for contributors and AI
coding agents live in [`AGENTS.md`](./AGENTS.md).

## License

MIT — see `LICENSE`.
