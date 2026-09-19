.pragma library

// Pure squad-safety checks for the Team tab: is your captain/vice actually
// playing, and can the bench cover flagged starters? Given raw picks +
// bootstrap + fixtures in, verdicts out — no network, no side effects.
//
// picksData: raw /entry/{id}/event/{gw}/picks/ ({ picks: [...] })
//   pick.position 1-11 = starters, 12-15 = bench (12 = sub keeper)
// bootstrapData: raw /bootstrap-static/ (status, news, chance, element_type)
// fixturesData: raw /fixtures/ array (or null — blank detection skipped)
// gw: gameweek the picks are for
// Returns { captain, vice, risks, allClear }.
// captain/vice: { playerName, risk, note }.
// risks[]: { playerName, tag ("C"/"VC"/""), reasons: [str],
//   coverName (fit bench cover) or null }.

var STATUS_LABELS = {
    a: "Available",
    i: "Injured",
    d: "Doubtful",
    s: "Suspended",
    u: "Unavailable"
}

function _isFlagStatus(status) {
    return status === "i" || status === "d" || status === "s" || status === "u"
}

function computeLineupCheck(picksData, bootstrapData, fixturesData, gw) {
    var empty = { captain: null, vice: null, risks: [], allClear: true }
    if (!picksData || !picksData.picks || !bootstrapData) return empty

    var players = {}
    var elements = bootstrapData.elements || []
    for (var e = 0; e < elements.length; e++) {
        var el = elements[e]
        if (el && el.id !== undefined) players[el.id] = el
    }

    var playing = null
    if (fixturesData) {
        playing = {}
        var list = fixturesData.fixtures ? fixturesData.fixtures : fixturesData
        for (var f = 0; f < list.length; f++) {
            var fx = list[f]
            if (!fx || fx.event !== gw) continue
            playing[fx.team_h] = true
            playing[fx.team_a] = true
        }
    }

    function riskReasons(pick) {
        var p = players[pick.element]
        var reasons = []
        if (!p) {
            reasons.push("unknown player")
            return reasons
        }
        if (_isFlagStatus(p.status)) {
            var label = STATUS_LABELS[p.status] || p.status
            var extra = ""
            if (p.chance_of_playing_this_round !== null && p.chance_of_playing_this_round !== undefined) {
                extra = " (" + p.chance_of_playing_this_round + "%)"
            }
            reasons.push(label.toLowerCase() + extra)
        } else if (p.chance_of_playing_this_round !== null &&
                   p.chance_of_playing_this_round !== undefined &&
                   p.chance_of_playing_this_round < 75) {
            reasons.push("only " + p.chance_of_playing_this_round + "% chance of playing")
        }
        if (playing !== null && p.team !== undefined && !playing[p.team]) {
            reasons.push("blank GW" + gw)
        }
        return reasons
    }

    function isFit(pick) {
        return riskReasons(pick).length === 0
    }

    var starters = []
    var bench = []
    var picks = picksData.picks
    for (var i = 0; i < picks.length; i++) {
        if (Number(picks[i].position || 0) <= 11) starters.push(picks[i])
        else bench.push(picks[i])
    }
    bench.sort(function (a, b) { return Number(a.position || 0) - Number(b.position || 0) })

    function nameOf(pick) {
        var p = players[pick.element]
        return (p && p.web_name) || ("#" + pick.element)
    }

    function isKeeper(pick) {
        var p = players[pick.element]
        return !!p && Number(p.element_type) === 1
    }

    function coverFor(starter) {
        var keeper = isKeeper(starter)
        for (var b = 0; b < bench.length; b++) {
            if (keeper !== isKeeper(bench[b])) continue
            if (isFit(bench[b])) return nameOf(bench[b])
        }
        return null
    }

    var captainPick = null
    var vicePick = null
    for (var s = 0; s < picks.length; s++) {
        if (picks[s].is_captain) captainPick = picks[s]
        if (picks[s].is_vice_captain) vicePick = picks[s]
    }

    function headNote(pick, otherName, otherRisk) {
        if (!pick) return { playerName: "—", risk: false, note: "not set" }
        var r = riskReasons(pick)
        var note = r.length === 0 ? "fit" : r.join(", ")
        if (r.length > 0 && otherName) {
            note += otherRisk ? " — deputy " + otherName + " flagged too" : " — deputy " + otherName + " fit"
        }
        return { playerName: nameOf(pick), risk: r.length > 0, note: note }
    }

    var viceRisk = vicePick ? riskReasons(vicePick).length > 0 : false
    var capRisk = captainPick ? riskReasons(captainPick).length > 0 : false
    var captain = headNote(captainPick, vicePick ? nameOf(vicePick) : null, viceRisk)
    var vice = headNote(vicePick, captainPick ? nameOf(captainPick) : null, capRisk)

    var risks = []
    for (var k = 0; k < starters.length; k++) {
        var reasons = riskReasons(starters[k])
        if (reasons.length === 0) continue
        risks.push({
            playerName: nameOf(starters[k]),
            tag: starters[k].is_captain ? "C" : (starters[k].is_vice_captain ? "VC" : ""),
            reasons: reasons,
            coverName: coverFor(starters[k])
        })
    }
    // Scariest first: captain, then vice, then the rest.
    var tagRank = { C: 0, VC: 1, "": 2 }
    risks.sort(function (a, b) { return tagRank[a.tag] - tagRank[b.tag] })

    return { captain: captain, vice: vice, risks: risks, allClear: risks.length === 0 }
}
