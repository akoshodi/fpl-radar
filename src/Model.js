.pragma library
.import "lib/FplApi.js" as Api
.import "lib/TopManagerAnalysis.js" as Analysis

// Single source of truth for both BarWidget.qml and Panel.qml.
// Owns timers/refresh scheduling and exposes plain getters the QML
// files bind to. No QML-specific code lives here — keep it testable
// as plain JS.
//
// Phase 1 scope (docs/ROADMAP.md): deadline countdown (local calc,
// no network per tick) + live gameweek points for the user's own team.
// Later phases fill in squadNews (P2), priceWatch (P3), and
// refreshTopManagerAnalysis (P4) — those remain stubs below.
//
// QML reactivity note: QML bindings to library functions are evaluated
// once and do NOT re-run on their own. BarWidget.qml owns a cheap 1s
// `tick` counter and a 60s refresh Timer; every getter below accepts an
// optional ignored `_tick` argument purely so QML can write e.g.
// `Model.deadlineText(tick)` and force re-evaluation each second.
// The argument never affects the result.

var state = {
    settings: {
        entryId: null,          // user's FPL team id, set via panel settings
        leagueId: 314,          // default: global "Overall" league
        topManagerSampleSize: 50
    },
    cache: {
        bootstrapStatic: null,  // { data, fetchedAt }
        fixtures: null,         // { data, fetchedAt }
        entry: null,            // { data, fetchedAt } — entry/{id}/ summary
        ownPicks: null,         // { data, fetchedAt, gameweek, entryId }
        liveEvent: null,        // { data, fetchedAt, gameweek }
        topManagerAnalysis: null // { data, fetchedAt, gameweek, sampleSize }
    },
    lastError: null             // last fetch failure string (kept for debugging)
}

// TTLs mirror docs/DATA_SOURCES.md. Keep in one place so every
// consumer checks freshness the same way.
var TTL_MS = {
    bootstrapStatic: 6 * 3600 * 1000,  // 6 hours
    fixtures: 6 * 3600 * 1000,         // 6 hours
    entry: 3600 * 1000,                // 1 hour
    ownPicks: 3600 * 1000,             // 1 hour for own team
    liveEvent: 60 * 1000               // 60s, only polled while a GW is live
}

var DEADLINE_AMBER_MS = 3 * 3600 * 1000   // under 3h → amber
var DEADLINE_RED_MS = 30 * 60 * 1000      // under 30m → red

// --- Time (overridable for fixture tests) ---

var _nowOverride = null
function _now() {
    if (_nowOverride !== null) return _nowOverride
    return Date.now()
}
function setNowOverride(msOrNull) { _nowOverride = msOrNull }

// --- Pluggable persistence (zero-dependency) ---
//
// ARCHITECTURE.md default is a plain JSON file under the plugin's data
// dir; AGENTS.md also allows QtQuick.LocalStorage. This module never
// touches the filesystem directly (no new APIs, stays unit-testable):
// QML wires a { load: fn, save: fn } adapter at startup. Without an
// adapter, state is memory-only for the session — offline degrade still
// works via the in-memory cache.

var _storage = null  // { load: function() -> string|null, save: function(string) }
function setStorage(adapter) { _storage = adapter }

function serializeState() {
    return JSON.stringify({ settings: state.settings, cache: state.cache })
}

function restoreState(jsonOrObj) {
    var obj = jsonOrObj
    if (typeof obj === "string") {
        try { obj = JSON.parse(obj) } catch (e) { return false }
    }
    if (!obj || typeof obj !== "object") return false
    if (obj.settings && typeof obj.settings === "object") {
        if (obj.settings.entryId !== undefined) state.settings.entryId = obj.settings.entryId
        if (obj.settings.leagueId) state.settings.leagueId = obj.settings.leagueId
        if (obj.settings.topManagerSampleSize) {
            state.settings.topManagerSampleSize = _clampSampleSize(obj.settings.topManagerSampleSize)
        }
    }
    if (obj.cache && typeof obj.cache === "object") {
        for (var k in state.cache) {
            if (obj.cache[k] !== undefined) state.cache[k] = obj.cache[k]
        }
    }
    return true
}

function persist() {
    if (!_storage || !_storage.save) return
    try { _storage.save(serializeState()) } catch (e) { /* never crash UI on save */ }
}

function _loadPersisted() {
    if (!_storage || !_storage.load) return
    var raw = null
    try { raw = _storage.load() } catch (e) { return }
    if (raw) restoreState(raw)
}

function setEntryId(entryId) {
    state.settings.entryId = entryId ? Number(entryId) : null
    // Switching teams invalidates per-team caches; shared bootstrap stays.
    state.cache.ownPicks = null
    state.cache.liveEvent = null
    state.cache.entry = null
    persist()
}

function setLeagueId(leagueId) {
    state.settings.leagueId = Number(leagueId) || 314
    persist()
}

function setTopManagerSampleSize(n) {
    state.settings.topManagerSampleSize = _clampSampleSize(n)
    persist()
}

function _clampSampleSize(n) {
    n = Number(n) || 50
    if (n < 1) return 1
    if (n > 200) return 200  // ROADMAP cap: don't self-inflict rate limits
    return Math.floor(n)
}

// --- Cache freshness ---

function _isFresh(entry, ttlMs) {
    if (!entry || !entry.fetchedAt) return false
    return (_now() - entry.fetchedAt) < ttlMs
}

// True when we hold data but it is older than its TTL or the last fetch
// failed — drives the visible "stale" indicator, never a blank widget.
function isStale(_tick) {
    if (state.lastError) return true
    if (state.cache.bootstrapStatic && !_isFresh(state.cache.bootstrapStatic, TTL_MS.bootstrapStatic)) return true
    if (state.settings.entryId && state.cache.ownPicks && !_isFresh(state.cache.ownPicks, TTL_MS.ownPicks)) return true
    return false
}

function staleText(_tick) {
    return isStale(_tick) ? " (stale)" : ""
}

function lastError() { return state.lastError }

// --- Bootstrap / gameweek helpers (pure, local-only) ---

function _events() {
    var bs = state.cache.bootstrapStatic
    if (!bs || !bs.data || !bs.data.events) return []
    return bs.data.events
}

function currentEvent() {
    var events = _events()
    for (var i = 0; i < events.length; i++) {
        if (events[i].is_current) return events[i]
    }
    return null
}

function nextEvent() {
    var events = _events()
    for (var j = 0; j < events.length; j++) {
        if (events[j].is_next) return events[j]
    }
    return null
}

// The gameweek whose points the widget should show: the live/current
// one if known, else the upcoming one, else null.
function displayGameweek() {
    var cur = currentEvent()
    if (cur) return cur.id
    var nxt = nextEvent()
    if (nxt) return nxt.id
    return null
}

function deadlineMs() {
    var nxt = nextEvent()
    if (!nxt || !nxt.deadline_time) return null
    var ms = Date.parse(nxt.deadline_time)
    if (isNaN(ms)) return null
    return ms
}

function msUntilDeadline() {
    var dl = deadlineMs()
    if (dl === null) return null
    return dl - _now()
}

// --- Bar widget getters (cheap: local calc over cached state only) ---

function isLive(_tick) {
    var cur = currentEvent()
    if (!cur) return false
    // Bootstrap flags: a current, unfinished gameweek whose deadline has
    // passed is the live window (first kickoff → last full-time+bonus).
    if (cur.finished) return false
    var dl = deadlineMs()
    var next = nextEvent()
    // If the "current" GW's own deadline is known, use it; otherwise any
    // is_current && !finished event counts as live (defensive against
    // mid-season endpoint shape quirks).
    if (cur.deadline_time) {
        var curDl = Date.parse(cur.deadline_time)
        if (!isNaN(curDl)) return _now() >= curDl
        return true
    }
    if (dl !== null && next && cur.id === next.id) return _now() >= dl
    return true
}

function isInLiveWindow() {
    return isLive()
}

function liveSummaryText(_tick) {
    if (!state.settings.entryId) return "Set FPL ID in panel"
    var gw = displayGameweek()
    var gwLabel = gw !== null ? "GW" + gw : "FPL"
    var pts = ownGwPoints()
    var stale = staleText(_tick)
    if (pts === null) {
        if (!state.cache.ownPicks) return gwLabel + ": --" + stale
        var fb = _picksFallbackPoints()
        if (fb !== null) return gwLabel + ": " + fb + " pts" + stale
        return gwLabel + ": --" + stale
    }
    if (isLive(_tick)) return gwLabel + " Live: " + pts + " pts" + stale
    return gwLabel + ": " + pts + " pts" + stale
}

function deadlineText(_tick) {
    var ms = msUntilDeadline()
    if (ms === null) return "Deadline: --"
    var nxt = nextEvent()
    var gwLabel = nxt ? "GW" + nxt.id : "Deadline"
    if (ms <= 0) return gwLabel + " deadline passed"
    return gwLabel + ": " + formatDuration(ms)
}

function deadlineColor(_tick) {
    var ms = msUntilDeadline()
    if (ms === null || ms <= 0) return "#cccccc"
    if (ms < DEADLINE_RED_MS) return "#e74c3c"
    if (ms < DEADLINE_AMBER_MS) return "#f39c12"
    return "#cccccc"
}

function formatDuration(ms) {
    if (ms < 0) ms = 0
    var totalSec = Math.floor(ms / 1000)
    var days = Math.floor(totalSec / 86400)
    var hours = Math.floor((totalSec % 86400) / 3600)
    var mins = Math.floor((totalSec % 3600) / 60)
    var secs = totalSec % 60
    if (days > 0) return days + "d " + hours + "h " + mins + "m"
    if (hours > 0) return hours + "h " + mins + "m"
    return mins + "m " + (secs < 10 ? "0" : "") + secs + "s"
}

function togglePanel() {
    // Hook for Omarchy's panel-open API for this plugin kind.
    // The scaffold does not define that API surface; BarWidget's
    // MouseArea click calls this so there is exactly one place to wire
    // it up once the host API is confirmed. No-op until then.
}

// --- Live points computation (pure: picks + live-event JSON in) ---

// liveData: raw /event/{gw}/live/ response ({ elements: [{id, stats:{total_points}}] })
// picksData: raw /entry/{id}/event/{gw}/picks/ response ({ picks: [...] })
// Returns integer points for the starting XI (multiplier > 0), or null
// when there is nothing usable to compute from.
function computeLivePoints(picksData, liveData) {
    if (!picksData || !picksData.picks || !liveData || !liveData.elements) return null
    var liveById = {}
    for (var i = 0; i < liveData.elements.length; i++) {
        var el = liveData.elements[i]
        var pts = el && el.stats ? el.stats.total_points : null
        if (el && el.id !== undefined && typeof pts === "number") liveById[el.id] = pts
    }
    var total = 0
    var counted = 0
    for (var j = 0; j < picksData.picks.length; j++) {
        var pick = picksData.picks[j]
        var mult = Number(pick.multiplier || 0)
        if (mult <= 0) continue  // bench — excluded until autosubs resolve
        if (liveById[pick.element] === undefined) continue
        total += liveById[pick.element] * mult
        counted++
    }
    if (counted === 0) return null
    return total
}

// entry_history.total_points embedded in the picks response — the last
// confirmed total; used when no live data is available (pre-kickoff,
// finished GW, or offline with cached picks).
function _picksFallbackPoints() {
    var op = state.cache.ownPicks
    if (op && op.data && op.data.entry_history && typeof op.data.entry_history.total_points === "number") {
        return op.data.entry_history.total_points
    }
    return null
}

// Best available points figure for the cached picks' gameweek:
// live calc when fresh live data matches the picks GW, else the
// confirmed entry_history total. Null when no usable cache exists.
function ownGwPoints() {
    var op = state.cache.ownPicks
    if (!op || !op.data) return null
    var le = state.cache.liveEvent
    if (le && le.data && op.gameweek && le.gameweek === op.gameweek) {
        var live = computeLivePoints(op.data, le.data)
        if (live !== null) return live
    }
    return _picksFallbackPoints()
}

// ---- Panel getters (Phase 2/3 — stubs until their phases) ----

function squadNews() {
    // TODO(agent Phase 2): filter bootstrap-static elements to the user's
    // own picks, map status/news fields. See docs/DATA_SOURCES.md.
    return []
}

function priceWatch() {
    // TODO(agent Phase 3): compare today's vs yesterday's cached
    // bootstrap-static now_cost/transfer deltas.
    // See docs/DATA_SOURCES.md#derived-data.
    return []
}

function chipStatus() {
    // TODO(agent Phase 2): derive from entry/{id}/ chip history.
    return []
}

// --- Refresh scheduling ---

function init(storageAdapter) {
    if (storageAdapter) setStorage(storageAdapter)
    _loadPersisted()
    refreshAll()
}

function needsBootstrapRefresh() {
    return !_isFresh(state.cache.bootstrapStatic, TTL_MS.bootstrapStatic)
}

function needsOwnPicksRefresh() {
    if (!state.settings.entryId) return false
    var op = state.cache.ownPicks
    var gw = displayGameweek()
    if (!op || !op.data) return true
    if (gw !== null && op.gameweek !== gw) return true
    if (op.entryId !== state.settings.entryId) return true
    return !_isFresh(op, TTL_MS.ownPicks)
}

function needsLiveRefresh() {
    if (!isInLiveWindow()) return false
    if (!state.settings.entryId) return false
    var le = state.cache.liveEvent
    var gw = displayGameweek()
    if (!le || !le.data) return true
    if (gw !== null && le.gameweek !== gw) return true
    return !_isFresh(le, TTL_MS.liveEvent)
}

function refreshAll() {
    refreshBootstrapIfDue()
    refreshOwnPicksIfDue()
    refreshLiveIfDue()
}

function refreshBootstrapIfDue() {
    if (!needsBootstrapRefresh()) return
    try {
        Api.fetchBootstrapStatic(
            function (data) {
                state.cache.bootstrapStatic = { data: data, fetchedAt: _now() }
                state.lastError = null
                persist()
                // Picks/live GW may have rolled over once we know the new
                // current GW — chain the dependent refreshes.
                refreshOwnPicksIfDue()
                refreshLiveIfDue()
            },
            function (err) {
                state.lastError = String(err)
                // Offline degrade: keep old cache (or stay empty on first
                // run) so the widget shows stale data, never blank.
                persist()
            }
        )
    } catch (e) {
        state.lastError = String(e)
    }
}

function refreshOwnPicksIfDue() {
    if (!needsOwnPicksRefresh()) return
    var gw = displayGameweek()
    // Without bootstrap we don't know the GW yet; bootstrap's callback
    // re-triggers this once it lands. GW null + live data absent means
    // nothing sensible to fetch.
    if (gw === null) return
    var entryId = state.settings.entryId
    try {
        Api.fetchPicks(
            entryId,
            gw,
            function (data) {
                state.cache.ownPicks = { data: data, fetchedAt: _now(), gameweek: gw, entryId: entryId }
                state.lastError = null
                persist()
                refreshLiveIfDue()
            },
            function (err) {
                state.lastError = String(err)
                persist()
            }
        )
    } catch (e) {
        state.lastError = String(e)
    }
}

function refreshLiveIfDue() {
    if (!needsLiveRefresh()) return
    var gw = displayGameweek()
    if (gw === null) return
    try {
        Api.fetchLiveEvent(
            gw,
            function (data) {
                state.cache.liveEvent = { data: data, fetchedAt: _now(), gameweek: gw }
                state.lastError = null
                persist()
            },
            function (err) {
                state.lastError = String(err)
                persist()
            }
        )
    } catch (e) {
        state.lastError = String(e)
    }
}

// ---- Top Manager Insights (docs/ROADMAP.md Phase 4) ----

function refreshTopManagerAnalysis() {
    // TODO(agent Phase 4): implement per docs/ROADMAP.md methodology:
    //   1. Api.fetchLeagueStandings(state.settings.leagueId, sampleSize)
    //   2. Api.fetchPicksForManagers(entryIds, gameweek) — throttled, see
    //      docs/DATA_SOURCES.md rate-limit notes
    //   3. Analysis.computeInsights(picksByManager, bootstrapStatic, gameweek)
    //   4. Cache result with fetchedAt/gameweek/sampleSize.
}

function analysisGameweek() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.gameweek : "-"
}

function analysisSampleSize() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.sampleSize : 0
}

function consensusCaptains() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.data.consensusCaptains : []
}

function eliteDifferentialsIn() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.data.differentialsIn : []
}

function eliteDifferentialsOut() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.data.differentialsOut : []
}
