.pragma library

// Pure aggregation functions implementing docs/ROADMAP.md#transfer--captain-suggestions-from-top-managers.
// Deliberately dependency-free (no lodash/underscore) and side-effect-free:
// given picks data in, ranked insight lists out. This makes it easy to
// sanity-check by hand with a small fixture object logged to the console,
// without needing a test framework.

// picksByManager: { entryId: { picks: [{element, is_captain, ...}, ...] } }
// bootstrapStatic: raw /bootstrap-static/ response (for player names + global ownership)
// Returns: { consensusCaptains, differentialsIn, differentialsOut }
function computeInsights(picksByManager, bootstrapStatic, options) {
    options = options || {}
    var topN = Math.max(3, options.topListSize || 5)

    var playerById = _indexPlayers(bootstrapStatic)
    var sampleSize = Object.keys(picksByManager).length

    var captaincyCounts = {}   // elementId -> count
    var ownershipCounts = {}   // elementId -> count (owned anywhere in the 15, captain or not)

    for (var entryId in picksByManager) {
        var picks = picksByManager[entryId].picks || []
        for (var i = 0; i < picks.length; i++) {
            var pick = picks[i]
            ownershipCounts[pick.element] = (ownershipCounts[pick.element] || 0) + 1
            if (pick.is_captain) {
                captaincyCounts[pick.element] = (captaincyCounts[pick.element] || 0) + 1
            }
        }
    }

    var consensusCaptains = _rankByCount(captaincyCounts, sampleSize, playerById, topN, "captaincyPct")

    var differentials = _computeDifferentials(ownershipCounts, sampleSize, playerById)
    differentials.sort(function(a, b) { return b.differential - a.differential })
    var differentialsIn = differentials.slice(0, topN)
    var differentialsOut = differentials.slice().sort(function(a, b) {
        return a.differential - b.differential
    }).slice(0, topN)

    return {
        consensusCaptains: consensusCaptains,
        differentialsIn: differentialsIn,
        differentialsOut: differentialsOut
    }
}

// TODO(agent): implement net-transfer trend (gw-1 vs gw comparison) per
// docs/ROADMAP.md — e.g. computeTrend(picksByManagerPrevGw, picksByManagerThisGw, ...)
// returning players whose ownershipCounts increased/decreased most within the sample.

function _indexPlayers(bootstrapStatic) {
    var byId = {}
    var elements = (bootstrapStatic && bootstrapStatic.elements) || []
    for (var i = 0; i < elements.length; i++) {
        var el = elements[i]
        byId[el.id] = {
            name: el.web_name,
            globalOwnershipPct: parseFloat(el.selected_by_percent)
        }
    }
    return byId
}

function _rankByCount(counts, sampleSize, playerById, topN, pctFieldName) {
    var rows = []
    for (var elementId in counts) {
        var player = playerById[elementId]
        if (!player) continue
        var row = { playerName: player.name }
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
            playerName: player.name,
            topOwnershipPct: Math.round(topPct * 10) / 10,
            globalOwnershipPct: Math.round(globalPct * 10) / 10,
            differential: Math.round((topPct - globalPct) * 10) / 10
        })
    }
    return rows
}
