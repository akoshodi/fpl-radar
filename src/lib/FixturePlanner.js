.pragma library

// Pure blank/double-gameweek planning from the full-season fixtures list.
// Given raw /fixtures/ + bootstrap teams in, upcoming windows out:
// [{ gw, blanks: [shortNames], doubles: [shortNames], hint }].
// Only gameweeks where SOMETHING happens are returned (normal gameweeks
// are the absence of rows, not rows saying "normal").
//
// fixturesData: raw /fixtures/ response (array, or { fixtures: [...] })
// teamsData: raw bootstrap-static (for the full team list + short names)
// fromGw: first gameweek to consider (usually the display gameweek)
// horizon: how many gameweeks ahead to scan (default 6)

function blankDoubleWindows(fixturesData, teamsData, fromGw, horizon) {
    horizon = Math.max(1, horizon || 6)
    var list = !fixturesData ? [] : (fixturesData.fixtures ? fixturesData.fixtures : fixturesData)
    var teams = (teamsData && teamsData.teams) || []
    var allNames = {}
    var shortById = {}
    for (var t = 0; t < teams.length; t++) {
        if (teams[t] && teams[t].id !== undefined) {
            allNames[teams[t].id] = true
            shortById[teams[t].id] = teams[t].short_name || ("#" + teams[t].id)
        }
    }

    var byEvent = {}
    for (var i = 0; i < list.length; i++) {
        var f = list[i]
        if (!f || f.event === undefined || f.event === null) continue
        if (fromGw !== null && fromGw !== undefined && f.event < fromGw) continue
        if (!byEvent[f.event]) byEvent[f.event] = []
        byEvent[f.event].push(f)
    }
    var events = Object.keys(byEvent).map(Number).sort(function (a, b) { return a - b }).slice(0, horizon)

    var windows = []
    for (var k = 0; k < events.length; k++) {
        var gw = events[k]
        var counts = {}
        var games = byEvent[gw]
        for (var g = 0; g < games.length; g++) {
            counts[games[g].team_h] = (counts[games[g].team_h] || 0) + 1
            counts[games[g].team_a] = (counts[games[g].team_a] || 0) + 1
        }
        var blanks = []
        var doubles = []
        for (var id in allNames) {
            var n = counts[id] || 0
            if (n === 0) blanks.push(shortById[id])
            else if (n >= 2) doubles.push(shortById[id])
        }
        blanks.sort()
        doubles.sort()
        if (blanks.length === 0 && doubles.length === 0) continue
        windows.push({ gw: gw, blanks: blanks, doubles: doubles, hint: _hint(gw, blanks, doubles) })
    }
    return windows
}

function _hint(gw, blanks, doubles) {
    var parts = []
    if (doubles.length > 0) {
        parts.push("Double GW" + gw + ": " + doubles.join(", ") + " play twice — classic Bench Boost territory")
    }
    if (blanks.length > 0) {
        parts.push("Blank GW" + gw + ": " + blanks.join(", ") + " sit out — plan transfers or a Free Hit")
    }
    return parts.join(". ")
}
