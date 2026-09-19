.pragma library

// Pure aggregation functions implementing docs/ROADMAP.md#transfer--captain-suggestions-from-top-managers.
// Deliberately dependency-free (no lodash/underscore) and side-effect-free:
// given picks data in, ranked insight lists out. This makes it easy to
// sanity-check by hand with a small fixture object logged to the console,
// without needing a test framework.

// picksByManager: { entryId: { picks: [{element, is_captain, ...}, ...] } }
// bootstrapStatic: raw /bootstrap-static/ response (for player names,
//   global ownership, teams)
// options: { topListSize, fixtures (raw /fixtures/ response or array),
//   gameweek (GW the picks are from, for next-fixture lookup),
//   prevPicksByManager (gw-1 picks, for net-transfer trend),
//   trendSize }
// Returns: { consensusCaptains, differentialsIn, differentialsOut,
//   differentials (full list, best first), trend: { in, out } }
function computeInsights(picksByManager, bootstrapStatic, options) {
    options = options || {}
    var topN = Math.max(3, options.topListSize || 5)
    var trendN = Math.max(1, options.trendSize || 3)

    var playerById = _indexPlayers(bootstrapStatic)
    var teamsById = _indexTeams(bootstrapStatic)
    var fixtures = options.fixtures && options.fixtures.fixtures ? options.fixtures.fixtures : options.fixtures
    var gw = (options.gameweek !== undefined && options.gameweek !== null) ? options.gameweek : null
    var sampleSize = picksByManager ? Object.keys(picksByManager).length : 0

    var ownershipCounts = _ownershipCounts(picksByManager)
    var captaincyCounts = _captaincyCounts(picksByManager)

    var consensusCaptains = _rankByCount(captaincyCounts, sampleSize, playerById, topN, "captaincyPct")
    var differentials = _computeDifferentials(ownershipCounts, sampleSize, playerById)
    differentials.sort(function(a, b) { return b.differential - a.differential })

    var ctx = { playerById: playerById, teamsById: teamsById, fixtures: fixtures, gameweek: gw }
    var i
    for (i = 0; i < consensusCaptains.length; i++) _decorate(consensusCaptains[i], ctx)
    for (i = 0; i < differentials.length; i++) _decorate(differentials[i], ctx)

    var differentialsIn = differentials.filter(function (r) { return r.differential > 0 }).slice(0, topN)
    var differentialsOut = differentials.filter(function (r) { return r.differential < 0 }).slice().sort(function(a, b) {
        return a.differential - b.differential
    }).slice(0, topN)

    var trend = { in: [], out: [] }
    if (options.prevPicksByManager) {
        trend = computeTrend(options.prevPicksByManager, picksByManager, playerById, teamsById, trendN)
    }

    return {
        consensusCaptains: consensusCaptains,
        differentialsIn: differentialsIn,
        differentialsOut: differentialsOut,
        differentials: differentials,
        trend: trend
    }
}

// Net-transfer trend: whose presence in top-N squads grew/shrank vs last
// gameweek. Counts use each GW's own sample (managers may differ); rows
// carry both percentages so the shift is auditable, not magic.
// Returns { in: [...], out: [...] } capped at n each.
function computeTrend(prevPicksByManager, currPicksByManager, playerById, teamsById, n) {
    n = Math.max(1, n || 3)
    var prevCounts = _ownershipCounts(prevPicksByManager)
    var currCounts = _ownershipCounts(currPicksByManager)
    var prevN = prevPicksByManager ? Object.keys(prevPicksByManager).length : 0
    var currN = currPicksByManager ? Object.keys(currPicksByManager).length : 0
    var seen = {}
    var id
    for (id in prevCounts) seen[id] = true
    for (id in currCounts) seen[id] = true
    var rows = []
    for (id in seen) {
        var player = (playerById || {})[id]
        if (!player) continue
        var delta = (currCounts[id] || 0) - (prevCounts[id] || 0)
        if (delta === 0) continue
        rows.push({
            element: Number(id),
            playerName: player.name,
            team: ((teamsById || {})[player.team]) || "",
            delta: delta,
            prevPct: prevN > 0 ? Math.round(((prevCounts[id] || 0) / prevN) * 1000) / 10 : 0,
            currPct: currN > 0 ? Math.round(((currCounts[id] || 0) / currN) * 1000) / 10 : 0
        })
    }
    rows.sort(function(a, b) { return b.delta - a.delta })
    var trendingIn = rows.filter(function (r) { return r.delta > 0 }).slice(0, n)
    var trendingOut = rows.filter(function (r) { return r.delta < 0 }).slice().sort(function(a, b) {
        return a.delta - b.delta
    }).slice(0, n)
    return { in: trendingIn, out: trendingOut }
}

// Next UNPLAYED fixture for a team at/after fromGw: "vs ARS (H)".
// Empty string when unknown — callers render it as absent, never as data.
function nextFixtureForTeam(fixtures, teamId, fromGw, teamsById) {
    if (!fixtures || teamId === undefined || teamId === null) return ""
    var best = null
    for (var i = 0; i < fixtures.length; i++) {
        var f = fixtures[i]
        if (!f || f.finished) continue
        if (f.event === undefined || f.event === null) continue
        if (fromGw !== null && fromGw !== undefined && f.event < fromGw) continue
        if (f.team_h !== teamId && f.team_a !== teamId) continue
        if (!best || f.event < best.event) best = f
    }
    if (!best) return ""
    var home = best.team_h === teamId
    var opp = (teamsById || {})[home ? best.team_a : best.team_h] || ""
    if (opp === "") return ""
    return "vs " + opp + (home ? " (H)" : " (A)")
}

function _ownershipCounts(picksByManager) {
    var counts = {}
    if (!picksByManager) return counts
    for (var entryId in picksByManager) {
        var picks = picksByManager[entryId].picks || []
        for (var i = 0; i < picks.length; i++) {
            var element = picks[i].element
            if (element === undefined) continue
            counts[element] = (counts[element] || 0) + 1
        }
    }
    return counts
}

function _captaincyCounts(picksByManager) {
    var counts = {}
    if (!picksByManager) return counts
    for (var entryId in picksByManager) {
        var picks = picksByManager[entryId].picks || []
        for (var i = 0; i < picks.length; i++) {
            if (picks[i].is_captain && picks[i].element !== undefined) {
                counts[picks[i].element] = (counts[picks[i].element] || 0) + 1
            }
        }
    }
    return counts
}

// Attach team short name + next fixture to a row carrying .element.
function _decorate(row, ctx) {
    var player = ctx.playerById ? ctx.playerById[row.element] : null
    row.team = ""
    row.nextFixture = ""
    if (!player) return row
    if (player.team !== undefined && player.team !== null) {
        row.team = (ctx.teamsById || {})[player.team] || ""
        row.nextFixture = nextFixtureForTeam(ctx.fixtures, player.team, ctx.gameweek, ctx.teamsById)
    }
    return row
}

function _indexPlayers(bootstrapStatic) {
    var byId = {}
    var elements = (bootstrapStatic && bootstrapStatic.elements) || []
    for (var i = 0; i < elements.length; i++) {
        var el = elements[i]
        byId[el.id] = {
            name: el.web_name,
            team: el.team,
            globalOwnershipPct: parseFloat(el.selected_by_percent)
        }
    }
    return byId
}

function _indexTeams(bootstrapStatic) {
    var byId = {}
    var teams = (bootstrapStatic && bootstrapStatic.teams) || []
    for (var i = 0; i < teams.length; i++) {
        if (teams[i] && teams[i].id !== undefined) byId[teams[i].id] = teams[i].short_name || ""
    }
    return byId
}

function _rankByCount(counts, sampleSize, playerById, topN, pctFieldName) {
    var rows = []
    for (var elementId in counts) {
        var player = playerById[elementId]
        if (!player) continue
        var row = { element: Number(elementId), playerName: player.name }
        row[pctFieldName] = sampleSize > 0 ? Math.round((counts[elementId] / sampleSize) * 1000) / 10 : 0
        rows.push(row)
    }
    rows.sort(function(a, b) { return b[pctFieldName] - a[pctFieldName] })
    return rows.slice(0, topN)
}

function _computeDifferentials(ownershipCounts, sampleSize, playerById) {
    var rows = []
    for (var elementId in ownershipCounts) {
        var player = playerById[elementId]
        if (!player) continue
        var topPct = sampleSize > 0 ? (ownershipCounts[elementId] / sampleSize) * 100 : 0
        var globalPct = player.globalOwnershipPct || 0
        rows.push({
            element: Number(elementId),
            playerName: player.name,
            topOwnershipPct: Math.round(topPct * 10) / 10,
            globalOwnershipPct: Math.round(globalPct * 10) / 10,
            differential: Math.round((topPct - globalPct) * 10) / 10
        })
    }
    return rows
}
