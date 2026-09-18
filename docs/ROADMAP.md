# Roadmap

Rough build order. Each phase should be independently shippable — a user with only Phase 1 installed still has a useful plugin.

## Phase 1 — Core bar widget
- Deadline countdown (local calc, no network per tick).
- Live gameweek points for the user's own team.

## Phase 2 — Panel basics
- Squad news (injury/press-conference flags).
- Chip tracker.

## Phase 3 — Price watch
- Day-over-day `now_cost` / transfer-delta tracking, surfaced as a short "rising/falling" list.

## Phase 4 — Transfer & Captain Suggestions from Top Managers

**Goal:** surface what the best-performing FPL managers are actually doing this gameweek, so the user can weigh their own plan against the "smart money" rather than just gut feel or generic punditry.

### Data pipeline

1. Pull `leagues-classic/314/standings/` (the global Overall league; user can override the league ID in settings to benchmark against a specific mini-league instead).
2. Take the top **N** managers by rank. Default `N = 50` — enough to see a real consensus without hammering the API (see rate-limit notes in `docs/DATA_SOURCES.md`). Make `N` a config value, capped at something sane (e.g. 200) so a user can't accidentally configure a self-inflicted rate-limit problem.
3. For each sampled manager, fetch `entry/{id}/event/{gw}/picks/` for the current (or most recently completed) gameweek. Space requests out; cache aggressively (once per day, after the deadline for that gameweek has passed so picks are final and not still changing).
4. Also fetch the same managers' picks for **gw - 1** where cached data exists, to approximate net transfers (comparing this week's 15 vs last week's 15). This is a proxy for "who did they buy/sell," since there's no direct top-manager transfer feed.

### Metrics computed (`TopManagerAnalysis.js`)

- **Captaincy consensus %** — of the sampled top managers, what % captained each player. The top 2–3 by this metric are your "consensus captain picks."
- **Effective ownership among elites** — ownership % *within the sampled top-N*, compared against the *global* ownership % from `bootstrap-static`. A player owned by 60% of top managers but only 15% globally is a strong "the elites are onto something" signal.
- **Differential score** — `(top-N ownership) − (global ownership)`. Positive and large = elites favor it more than the public (a transfer-in candidate worth a look). Negative and large = elites are fading a template player the public still owns heavily (a potential transfer-out signal).
- **Net transfer trend** — comparing gw-1 vs gw picks across the sample: players whose presence in top-N squads increased week-over-week are "trending in" among elites; decreased = "trending out." Treat this as a soft signal (small week-to-week noise is expected at N=50).

### Output surfaced in the panel

A "Top Manager Insights" section with three short lists, each capped at 3–5 players so it stays scannable:

- **Consensus captains** — player, captaincy % among sampled top managers, and their next fixture.
- **Elite differentials (transfer-in candidates)** — highest positive differential score, with top-N ownership vs global ownership shown side by side so the gap is visible.
- **Elites fading (transfer-out candidates)** — highest negative differential score among players the user currently owns.

Every list item should be explainable in one line — e.g. *"Owned by 68% of the sampled top 50 vs 22% globally — a clear differential."* Resist adding a vague "confidence score"; the raw percentages are more honest and more useful than a synthetic number.

### Guardrails

- This is a descriptive signal ("what elites are doing"), not a prediction or guaranteed-good pick — the panel copy should reflect that (e.g. "Top managers are favoring…" rather than "You should…").
- Sample size matters: surface `N` and the gameweek the data is from directly in the UI, so the user can judge how much weight to give it.
- If the sample fetch is incomplete (some requests failed), compute from whatever succeeded but flag the effective sample size rather than silently treating it as N.

## Phase 5 (stretch) — Historical trend charts
- Would likely need the `LocalStorage` escape valve described in `docs/ARCHITECTURE.md` since it requires keeping more than "latest snapshot" data. Lower priority — only pursue if Phases 1–4 are solid and there's clear appetite for it.
