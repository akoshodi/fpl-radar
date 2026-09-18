# Data Sources

All data comes from the public, unauthenticated Fantasy Premier League API (`https://fantasy.premierleague.com/api/`). It's not officially documented by the FPL team, so endpoints are community-reverse-engineered and can change without notice — wrap every call in `FplApi.js` with error handling that falls back to cache.

## Endpoints used

| Endpoint | Purpose | Suggested refresh TTL |
|---|---|---|
| `GET /bootstrap-static/` | Full player list, teams, current gameweek, deadline times, global ownership %, price. The single most important endpoint — most features derive from this. | 6 hours (or on app open if stale) |
| `GET /fixtures/` | Fixture list and difficulty ratings, per gameweek. | 6 hours |
| `GET /entry/{team_id}/` | The user's own team summary (rank, total points, chip history). | 1 hour |
| `GET /entry/{team_id}/event/{gw}/picks/` | The user's own picks for a given gameweek (also used per top-manager, see below). | 1 hour for own team; once/day per sampled top manager |
| `GET /entry/{team_id}/transfers/` | The user's transfer history — used for the chip/transfer tracker. | 1 hour |
| `GET /entry/{team_id}/history/` | Per-gameweek history plus `chips` (which chip was played in which event) — primary source for the chip tracker. | 1 hour |
| `GET /leagues-classic/{league_id}/standings/` | Ranked list of managers in a league. Default `league_id = 314` (the global "Overall" league). Paginated (`page_standings`) — only pull enough pages to get your configured sample size (see below). | Daily |
| `GET /event/{gw}/live/` | Live per-player stats (points breakdown) for a gameweek in progress. Used for the bar widget's live points ticker. | 30–60s, **only while a gameweek is live** |

## Rate-limit / etiquette notes

- The API has no published rate limit, which means it's easy to accidentally abuse it. Treat it as a shared, informal resource.
- `leagues-classic/314/standings/` returns the *global* top managers — pulling picks for even a modest sample (e.g. top 50) means 50 separate requests to `event/{gw}/picks/` for different entry IDs. Space these out (e.g. one every 200–300ms) rather than firing them concurrently, and cache the result for the full day.
- Never re-run the top-manager analysis on every panel open — only on the schedule in `docs/ARCHITECTURE.md`.
- If a request fails (network blip, endpoint shape change), log and fall back to the last cached value rather than retrying in a tight loop.

## Derived data (computed locally, not fetched)

- **Deadline countdown** — from `bootstrap-static.events[].deadline_time` for the next event where `is_next == true`.
- **Price-change signal** — FPL doesn't expose "about to rise/fall" directly. Approximate it by tracking `now_cost` and `transfers_in_event`/`transfers_out_event` deltas across consecutive `bootstrap-static` snapshots (requires keeping yesterday's snapshot cached alongside today's).
- **Squad news** — `bootstrap-static.elements[].status` (`i` = injured, `d` = doubtful, `s` = suspended, `u` = unavailable) and `.news` (free-text press-conference/injury note) fields, filtered to the user's own 15 picks.
- **Captaincy/differential analysis** — see `docs/ROADMAP.md#transfer--captain-suggestions-from-top-managers`; combines `leagues-classic` standings with per-manager `picks` and global ownership from `bootstrap-static`.
