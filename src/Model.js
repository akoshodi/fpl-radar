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
// Phase 2 (done): squad-news flags + chip tracker for the panel.
// Later phases fill in priceWatch (P3) and refreshTopManagerAnalysis
// (P4) — those remain stubs below.
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
        bootstrapStaticPrev: null, // previous snapshot — baseline for price watch
        fixtures: null,         // { data, fetchedAt }
        entry: null,            // { data, fetchedAt, entryId } — entry/{id}/ summary
        entryHistory: null,     // { data, fetchedAt, entryId } — entry/{id}/history/ (chip usage)
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
    entryHistory: 3600 * 1000,         // 1 hour (chip tracker)
    ownPicks: 3600 * 1000,             // 1 hour for own team
    liveEvent: 60 * 1000,              // 60s, only polled while a GW is live
    topManagerAnalysis: 24 * 3600 * 1000 // daily (docs/DATA_SOURCES.md)
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
    state.cache.entryHistory = null
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

function hasEntryId(_tick) {
    return !!state.settings.entryId
}

// Deep link for the panel footer's "Open FPL" button: the manager's own
// team page when configured, else the FPL homepage. Click-only, never
// fetched — the API host stays the sole network contact.
function fplUrl(_tick) {
    if (state.settings.entryId) {
        var gw = displayGameweek()
        var suffix = gw !== null ? "/event/" + gw : ""
        return "https://fantasy.premierleague.com/entry/" + state.settings.entryId + suffix
    }
    return "https://fantasy.premierleague.com/"
}

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
    // If the "current" GW's own deadline is known, use it; otherwise fall
    // back to the next deadline when current and next are the same event.
    // When the shape is unrecognisable, assume NOT live: a false negative
    // just delays live polling, while a false positive paints the pill
    // urgent red and hammers the live endpoint for no reason.
    if (cur.deadline_time) {
        var curDl = Date.parse(cur.deadline_time)
        if (!isNaN(curDl)) return _now() >= curDl
        return false
    }
    if (dl !== null && next && cur.id === next.id) return _now() >= dl
    return false
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

// ---- Panel getters: Squad news (Phase 2) ----

// FPL status codes on bootstrap-static elements (see DATA_SOURCES.md).
var STATUS_LABELS = {
    a: "Available",
    i: "Injured",
    d: "Doubtful",
    s: "Suspended",
    u: "Unavailable"
}

// Flag-worthy statuses; "a" (available) rows never surface.
function _isFlagStatus(status) {
    return status === "i" || status === "d" || status === "s" || status === "u"
}

// Pure: build squad-news rows from raw bootstrap-static + raw picks.
// Each row: { playerName, status, statusLabel, note, chanceOfPlaying,
//   isCaptain, isViceCaptain, onBench }.
function computeSquadNews(bootstrapData, picksData) {
    if (!bootstrapData || !picksData || !picksData.picks) return []
    var elements = bootstrapData.elements || []
    var byId = {}
    for (var i = 0; i < elements.length; i++) {
        if (elements[i] && elements[i].id !== undefined) byId[elements[i].id] = elements[i]
    }
    var rows = []
    for (var j = 0; j < picksData.picks.length; j++) {
        var pick = picksData.picks[j]
        var el = byId[pick.element]
        if (!el) continue
        var news = (el.news || "").replace(/^\s+|\s+$/g, "")
        var flagged = _isFlagStatus(el.status)
        if (!flagged && news === "") continue
        rows.push({
            playerName: el.web_name || ("#" + pick.element),
            status: el.status || "",
            statusLabel: STATUS_LABELS[el.status] || (el.status || "Unknown"),
            note: news !== "" ? news : (STATUS_LABELS[el.status] || "Status changed"),
            chanceOfPlaying: (el.chance_of_playing_this_round !== null &&
                el.chance_of_playing_this_round !== undefined)
                ? el.chance_of_playing_this_round : null,
            isCaptain: !!pick.is_captain,
            isViceCaptain: !!pick.is_vice_captain,
            onBench: !(Number(pick.multiplier || 0) > 0)
        })
    }
    // Most severe first: suspended/unavailable, injured, doubtful — then
    // captains within the same band so the scary rows read first.
    var severity = { s: 0, u: 0, i: 1, d: 2 }
    rows.sort(function (a, b) {
        var sa = severity[a.status] !== undefined ? severity[a.status] : 3
        var sb = severity[b.status] !== undefined ? severity[b.status] : 3
        if (sa !== sb) return sa - sb
        if (a.isCaptain !== b.isCaptain) return a.isCaptain ? -1 : 1
        if (a.isViceCaptain !== b.isViceCaptain) return a.isViceCaptain ? -1 : 1
        return 0
    })
    return rows
}

// Panel-facing getter: cached data only, never fetches. Empty array means
// "no flags" when we have both caches, "no data yet" otherwise — the panel
// tells those apart via squadNewsState().
function squadNews() {
    var bs = state.cache.bootstrapStatic
    var op = state.cache.ownPicks
    if (!bs || !bs.data || !op || !op.data) return []
    return computeSquadNews(bs.data, op.data)
}

// "ready" (both caches present — empty list genuinely means all clear),
// "need-id" (no Team ID configured), or "loading" (waiting on fetches).
function squadNewsState() {
    if (!state.settings.entryId) return "need-id"
    if (!state.cache.bootstrapStatic || !state.cache.bootstrapStatic.data) return "loading"
    if (!state.cache.ownPicks || !state.cache.ownPicks.data) return "loading"
    return "ready"
}

// ---- Panel getters: Chip tracker (Phase 2) ----

// Canonical chip names as the FPL API spells them in history.chips.
var ALL_CHIPS = ["wildcard", "freehit", "bboost", "3xc"]

// Friendly labels for the panel.
var CHIP_LABELS = {
    wildcard: "Wildcard",
    freehit: "Free Hit",
    bboost: "Bench Boost",
    "3xc": "Triple Captain"
}

// Pure: derive chip rows from raw /entry/{id}/history/ data.
// Each row: { name, chip, used, usedEvent } — always all four chips,
// ordered Wildcard / Free Hit / Bench Boost / Triple Captain. Unknown
// entries in the payload are ignored so an API shape change degrades to
// "available" rather than crashing.
function computeChipStatus(historyData) {
    var usedByChip = {}
    var chips = (historyData && historyData.chips) || []
    for (var i = 0; i < chips.length; i++) {
        var c = chips[i]
        if (!c || !c.name) continue
        if (ALL_CHIPS.indexOf(c.name) === -1) continue
        // Keep the earliest event if a chip somehow appears twice.
        if (usedByChip[c.name] === undefined) usedByChip[c.name] = c.event !== undefined ? c.event : null
    }
    var rows = []
    for (var j = 0; j < ALL_CHIPS.length; j++) {
        var chip = ALL_CHIPS[j]
        rows.push({
            name: CHIP_LABELS[chip],
            chip: chip,
            used: usedByChip[chip] !== undefined,
            usedEvent: usedByChip[chip] !== undefined ? usedByChip[chip] : null
        })
    }
    return rows
}

function chipStatus() {
    var eh = state.cache.entryHistory
    if (!eh || !eh.data) return []
    return computeChipStatus(eh.data)
}

function chipState() {
    if (!state.settings.entryId) return "need-id"
    if (!state.cache.entryHistory || !state.cache.entryHistory.data) return "loading"
    return "ready"
}

function chipSummaryText() {
    var rows = chipStatus()
    if (chipState() !== "ready") return ""
    var left = []
    for (var i = 0; i < rows.length; i++) {
        if (!rows[i].used) left.push(rows[i].name)
    }
    if (left.length === 0) return "All chips used"
    return left.length + " chips left: " + left.join(", ")
}

// ---- Panel getters: Price watch (Phase 3) ----

// FPL exposes no "about to rise/fall" flag, so approximate it from
// consecutive bootstrap snapshots (see DATA_SOURCES.md#derived-data):
//   - a realised move: now_cost changed between snapshots (units of £0.1m)
//   - momentum: today's net transfers (in − out) minus yesterday's.
//     transfers_in/out_event reset every gameweek, so momentum is only
//     valid when both snapshots sit in the same GW — otherwise null.
var PRICE_TOP_N = 5
var PRICE_MOMENTUM_THRESHOLD = 10000  // net transfers/day worth flagging

function _currentEventId(bootstrapData) {
    var events = (bootstrapData && bootstrapData.events) || []
    for (var i = 0; i < events.length; i++) {
        if (events[i].is_current) return events[i].id
    }
    return null
}

// Pure: build { risers, fallers } from two raw bootstrap-static payloads.
// Row: { playerName, team, cost, costDelta, netTransfers, momentum,
//   direction ("up"/"down"), note }.
function computePriceWatch(prevData, currData, options) {
    options = options || {}
    var topN = options.topN || PRICE_TOP_N
    var threshold = options.momentumThreshold || PRICE_MOMENTUM_THRESHOLD
    if (!prevData || !currData) return { risers: [], fallers: [] }

    var momentumValid = _currentEventId(prevData) !== null &&
        _currentEventId(prevData) === _currentEventId(currData)

    var teams = {}
    var currTeams = currData.teams || []
    for (var t = 0; t < currTeams.length; t++) {
        if (currTeams[t] && currTeams[t].id !== undefined) teams[currTeams[t].id] = currTeams[t].short_name || ""
    }

    var prevById = {}
    var prevElements = prevData.elements || []
    for (var p = 0; p < prevElements.length; p++) {
        if (prevElements[p] && prevElements[p].id !== undefined) prevById[prevElements[p].id] = prevElements[p]
    }

    var risers = []
    var fallers = []
    var currElements = currData.elements || []
    for (var i = 0; i < currElements.length; i++) {
        var el = currElements[i]
        if (!el || el.id === undefined) continue
        var prev = prevById[el.id]
        if (!prev) continue
        var costDelta = Number(el.now_cost || 0) - Number(prev.now_cost || 0)
        var netCurr = Number(el.transfers_in_event || 0) - Number(el.transfers_out_event || 0)
        var netPrev = Number(prev.transfers_in_event || 0) - Number(prev.transfers_out_event || 0)
        var momentum = momentumValid ? netCurr - netPrev : null
        var row = {
            playerName: el.web_name || ("#" + el.id),
            team: teams[el.team] || "",
            cost: formatCost(el.now_cost),
            costDelta: costDelta,
            netTransfers: netCurr,
            momentum: momentum,
            direction: costDelta > 0 ? "up" : (costDelta < 0 ? "down" : (momentum !== null && momentum >= threshold ? "up" : (momentum !== null && momentum <= -threshold ? "down" : "flat"))),
            note: ""
        }
        row.note = priceNote(row)
        if (row.direction === "up") risers.push(row)
        else if (row.direction === "down") fallers.push(row)
    }

    risers.sort(function (a, b) {
        if (b.costDelta !== a.costDelta) return b.costDelta - a.costDelta
        return (b.momentum || 0) - (a.momentum || 0)
    })
    fallers.sort(function (a, b) {
        if (a.costDelta !== b.costDelta) return a.costDelta - b.costDelta
        return (a.momentum || 0) - (b.momentum || 0)
    })
    return { risers: risers.slice(0, topN), fallers: fallers.slice(0, topN) }
}

// One honest line per row — realised moves first, momentum as "watch".
function priceNote(row) {
    var parts = []
    if (row.costDelta > 0) parts.push("up " + formatCostDelta(row.costDelta) + " overnight")
    else if (row.costDelta < 0) parts.push("down " + formatCostDelta(row.costDelta) + " overnight")
    if (row.momentum !== null && Math.abs(row.momentum) >= PRICE_MOMENTUM_THRESHOLD) {
        parts.push(formatNet(row.momentum) + " net today" +
            (row.costDelta === 0 ? (row.momentum > 0 ? " — rise watch" : " — fall watch") : ""))
    } else if (row.costDelta === 0 && row.momentum !== null) {
        parts.push(formatNet(row.momentum) + " net today")
    }
    if (parts.length === 0 && row.momentum === null) parts.push("no baseline momentum (GW rolled over)")
    return parts.join(", ")
}

function formatCost(nowCost) {
    return "\u00A3" + (Number(nowCost || 0) / 10).toFixed(1) + "m"
}

function formatCostDelta(deltaUnits) {
    var m = Math.abs(Number(deltaUnits || 0) / 10).toFixed(1)
    return (deltaUnits < 0 ? "-\u00A3" : "\u00A3") + m + "m"
}

function formatNet(n) {
    var sign = n < 0 ? "-" : "+"
    return sign + (Math.abs(Number(n || 0)) / 1000).toFixed(1) + "k"
}

// Panel-facing getter: cached snapshots only, never fetches.
function priceWatch() {
    var curr = state.cache.bootstrapStatic
    var prev = state.cache.bootstrapStaticPrev
    if (!curr || !curr.data || !prev || !prev.data) return { risers: [], fallers: [] }
    return computePriceWatch(prev.data, curr.data)
}

// "ready" (two snapshots — lists may still be legitimately empty),
// "baseline" (first snapshot only — moves appear after the next refresh),
// or "loading" (no data yet).
function priceWatchState() {
    if (!state.cache.bootstrapStatic || !state.cache.bootstrapStatic.data) return "loading"
    if (!state.cache.bootstrapStaticPrev || !state.cache.bootstrapStaticPrev.data) return "baseline"
    return "ready"
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

function needsEntryHistoryRefresh() {
    if (!state.settings.entryId) return false
    var eh = state.cache.entryHistory
    if (!eh || !eh.data) return true
    if (eh.entryId !== state.settings.entryId) return true
    return !_isFresh(eh, TTL_MS.entryHistory)
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
    refreshEntryHistoryIfDue()
    refreshFixturesIfDue()
    refreshTopManagerAnalysis()
}

function refreshBootstrapIfDue() {
    if (!needsBootstrapRefresh()) return
    try {
        Api.fetchBootstrapStatic(
            function (data) {
                // Rotate: the previous snapshot becomes the baseline for
                // price watch (Phase 3). Refreshes are TTL-gated (6h), so
                // the baseline is always hours older, never minutes.
                if (state.cache.bootstrapStatic && state.cache.bootstrapStatic.data) {
                    state.cache.bootstrapStaticPrev = state.cache.bootstrapStatic
                }
                state.cache.bootstrapStatic = { data: data, fetchedAt: _now() }
                state.lastError = null
                persist()
                // Picks/live GW may have rolled over once we know the new
                // current GW — chain the dependent refreshes.
                refreshOwnPicksIfDue()
                refreshLiveIfDue()
                refreshFixturesIfDue()
                refreshTopManagerAnalysis()
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

function refreshEntryHistoryIfDue() {
    if (!needsEntryHistoryRefresh()) return
    var entryId = state.settings.entryId
    try {
        Api.fetchEntryHistory(
            entryId,
            function (data) {
                state.cache.entryHistory = { data: data, fetchedAt: _now(), entryId: entryId }
                state.lastError = null
                persist()
            },
            function (err) {
                state.lastError = String(err)
                // Offline degrade: keep old chip list (or empty on first
                // run) so the panel shows stale rows, never blanks.
                persist()
            }
        )
    } catch (e) {
        state.lastError = String(e)
    }
}

// ---- Top Manager Insights (docs/ROADMAP.md Phase 4) ----

// Which gameweek to analyse: the current one once its deadline has passed
// (picks are locked = final), else the most recently finished one —
// analysing a still-open gameweek would read teams managers can change.
function gwForAnalysis() {
    var cur = currentEvent()
    if (cur && !cur.finished && cur.deadline_time) {
        var dl = Date.parse(cur.deadline_time)
        if (!isNaN(dl) && _now() >= dl) return cur.id
    }
    var best = null
    var events = _events()
    for (var i = 0; i < events.length; i++) {
        if (events[i].finished && (best === null || events[i].id > best)) best = events[i].id
    }
    if (best !== null) return best
    return displayGameweek()
}

function needsFixturesRefresh() {
    return !_isFresh(state.cache.fixtures, TTL_MS.fixtures)
}

function refreshFixturesIfDue(onDone) {
    if (!needsFixturesRefresh()) {
        if (onDone) onDone(true)
        return
    }
    try {
        Api.fetchFixtures(
            function (data) {
                state.cache.fixtures = { data: data, fetchedAt: _now() }
                state.lastError = null
                persist()
                if (onDone) onDone(true)
            },
            function (err) {
                state.lastError = String(err)
                persist()
                if (onDone) onDone(false)
            }
        )
    } catch (e) {
        state.lastError = String(e)
        if (onDone) onDone(false)
    }
}

function needsTopManagerRefresh() {
    var a = state.cache.topManagerAnalysis
    var gw = gwForAnalysis()
    if (!a || !a.data) return true
    if (gw !== null && a.gameweek !== gw) return true
    if (a.leagueId !== state.settings.leagueId) return true
    // Compare the CONFIGURED sample size, not ids found: small leagues
    // legitimately return fewer teams than requested without going stale.
    if (a.sampleSetting !== state.settings.topManagerSampleSize) return true
    return !_isFresh(a, TTL_MS.topManagerAnalysis)
}

var _analysisRunning = false

function refreshTopManagerAnalysis() {
    if (_analysisRunning) return
    if (!needsTopManagerRefresh()) return
    var gw = gwForAnalysis()
    if (gw === null) return  // no bootstrap yet; its callback re-triggers us
    _analysisRunning = true
    var leagueId = state.settings.leagueId
    var sampleSize = state.settings.topManagerSampleSize
    // Fixtures first (for next-fixture strings); analysis proceeds with or
    // without them — a missing fixture is rendered as absent, never fatal.
    refreshFixturesIfDue(function () {
        try {
            Api.fetchLeagueStandings(
                leagueId,
                sampleSize,
                function (entryIds) {
                    if (!entryIds || entryIds.length === 0) {
                        state.lastError = "empty standings for league " + leagueId
                        _analysisRunning = false
                        persist()
                        return
                    }
                    Api.fetchPicksForManagers(entryIds, gw, null, function (picks, gwStats) {
                        var finishPrev = function (prevPicks, prevStats) {
                            var bs = state.cache.bootstrapStatic
                            var insights = Analysis.computeInsights(picks, bs ? bs.data : null, {
                                topListSize: 5,
                                fixtures: state.cache.fixtures ? state.cache.fixtures.data : null,
                                gameweek: gw,
                                prevPicksByManager: prevPicks
                            })
                            state.cache.topManagerAnalysis = {
                                data: insights,
                                fetchedAt: _now(),
                                gameweek: gw,
                                leagueId: leagueId,
                                sampleSize: gwStats.succeeded,
                                requestedSampleSize: gwStats.requested,
                                sampleSetting: sampleSize,
                                prevSampleSize: prevStats ? prevStats.succeeded : 0
                            }
                            state.lastError = null
                            _analysisRunning = false
                            persist()
                        };
                        // gw-1 trend is best-effort: without it the core
                        // lists still compute; trend just stays empty.
                        if (gw > 1) {
                            Api.fetchPicksForManagers(entryIds, gw - 1, null, function (prevPicks, prevStats) {
                                finishPrev(prevPicks, prevStats)
                            })
                        } else {
                            finishPrev({}, { requested: 0, succeeded: 0, failed: 0 })
                        }
                    })
                },
                function (err) {
                    state.lastError = String(err)
                    _analysisRunning = false
                    persist()
                }
            )
        } catch (e) {
            state.lastError = String(e)
            _analysisRunning = false
        }
    })
}

function topManagerState() {
    if (!state.cache.topManagerAnalysis || !state.cache.topManagerAnalysis.data) return "loading"
    return "ready"
}

function analysisGameweek() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.gameweek : "-"
}

function analysisSampleSize() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.sampleSize : 0
}

// Honest partial-fetch flag per the Phase 4 guardrails, else "".
function analysisNote() {
    var a = state.cache.topManagerAnalysis
    if (!a || !a.data) return ""
    if (a.sampleSize < a.requestedSampleSize) {
        return "partial: " + a.sampleSize + " of " + a.requestedSampleSize + " teams loaded"
    }
    return ""
}

function consensusCaptains() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.data.consensusCaptains : []
}

function eliteDifferentialsIn() {
    return state.cache.topManagerAnalysis ? state.cache.topManagerAnalysis.data.differentialsIn : []
}

// "Elites fading" scoped to players the user owns (needs own squad).
function hasOwnSquad() {
    return !!(state.cache.ownPicks && state.cache.ownPicks.data && state.cache.ownPicks.data.picks)
}

function ownElementIds() {
    if (!hasOwnSquad()) return null
    var ids = {}
    var picks = state.cache.ownPicks.data.picks || []
    for (var i = 0; i < picks.length; i++) {
        if (picks[i].element !== undefined) ids[picks[i].element] = true
    }
    return ids
}

function eliteDifferentialsOut() {
    var a = state.cache.topManagerAnalysis
    if (!a || !a.data) return []
    var owned = ownElementIds()
    if (!owned) return []
    var rows = (a.data.differentials || []).filter(function (r) {
        return owned[r.element] && r.differential < 0
    })
    rows.sort(function (x, y) { return x.differential - y.differential })
    return rows.slice(0, 5)
}

function trendRowsIn() {
    var a = state.cache.topManagerAnalysis
    return a && a.data && a.data.trend ? a.data.trend.in : []
}

function trendRowsOut() {
    var a = state.cache.topManagerAnalysis
    return a && a.data && a.data.trend ? a.data.trend.out : []
}
