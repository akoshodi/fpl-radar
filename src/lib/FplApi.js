.pragma library

// Thin wrapper over the public FPL API. No business logic here —
// just requests and JSON parsing. See docs/DATA_SOURCES.md for the
// full endpoint list, TTLs, and rate-limit etiquette.

var BASE = "https://fantasy.premierleague.com/api"

function _getJson(url, onSuccess, onError) {
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            if (xhr.status === 200) {
                try {
                    onSuccess(JSON.parse(xhr.responseText))
                } catch (e) {
                    onError("parse-error: " + e)
                }
            } else {
                onError("http-error: " + xhr.status)
            }
        }
    }
    xhr.open("GET", url)
    xhr.send()
}

function fetchBootstrapStatic(onSuccess, onError) {
    _getJson(BASE + "/bootstrap-static/", onSuccess, onError)
}

function fetchFixtures(onSuccess, onError) {
    _getJson(BASE + "/fixtures/", onSuccess, onError)
}

function fetchEntry(entryId, onSuccess, onError) {
    _getJson(BASE + "/entry/" + entryId + "/", onSuccess, onError)
}

function fetchPicks(entryId, gameweek, onSuccess, onError) {
    _getJson(BASE + "/entry/" + entryId + "/event/" + gameweek + "/picks/", onSuccess, onError)
}

function fetchTransfers(entryId, onSuccess, onError) {
    _getJson(BASE + "/entry/" + entryId + "/transfers/", onSuccess, onError)
}

function fetchEntryHistory(entryId, onSuccess, onError) {
    _getJson(BASE + "/entry/" + entryId + "/history/", onSuccess, onError)
}

function fetchLeagueStandingsPage(leagueId, page, onSuccess, onError) {
    _getJson(BASE + "/leagues-classic/" + leagueId + "/standings/?page_standings=" + page, onSuccess, onError)
}

function fetchLiveEvent(gameweek, onSuccess, onError) {
    _getJson(BASE + "/event/" + gameweek + "/live/", onSuccess, onError)
}

// Collect the top `sampleSize` entry ids from a classic-league standings
// table, following `page_standings` pages until enough are gathered or the
// league runs out. One page at a time — never concurrent. Sample size is
// clamped (see docs/ROADMAP.md) so a misconfigured client can't fan out.
function fetchLeagueStandings(leagueId, sampleSize, onSuccess, onError) {
    var want = Math.max(1, Math.min(200, Number(sampleSize) || 50))
    var ids = []
    var page = 1
    function finish() { onSuccess(ids.slice(0, want)) }
    function next() {
        if (page > 10) { finish(); return }  // safety: ~500 entries max
        fetchLeagueStandingsPage(leagueId, page, function (data) {
            var st = (data && data.standings) || {}
            var results = st.results || []
            for (var i = 0; i < results.length; i++) {
                if (results[i] && results[i].entry !== undefined) ids.push(results[i].entry)
                if (ids.length >= want) break
            }
            if (ids.length >= want || !st.has_next) finish()
            else { page++; next() }
        }, onError)
    }
    next()
}

// Fetch picks for many managers SEQUENTIALLY: each request starts only
// after the previous one settles, so we never fan out against the FPL
// API (round-trip latency provides the spacing; see rate-limit notes in
// docs/DATA_SOURCES.md). Failures are skipped and counted, never fatal.
// onProgress(done, total, entryId, ok) is optional; onDone always fires:
// onDone(resultsByEntryId, { requested, succeeded, failed }).
function fetchPicksForManagers(entryIds, gameweek, onProgress, onDone) {
    var ids = entryIds || []
    var results = {}
    var succeeded = 0
    var failed = 0
    var i = 0
    function report(entryId, ok) {
        if (onProgress) { try { onProgress(succeeded + failed, ids.length, entryId, ok) } catch (e) {} }
    }
    function step() {
        if (i >= ids.length) {
            onDone(results, { requested: ids.length, succeeded: succeeded, failed: failed })
            return
        }
        var entryId = ids[i]
        i++
        fetchPicks(entryId, gameweek,
            function (data) {
                results[entryId] = data
                succeeded++
                report(entryId, true)
                step()
            },
            function () {
                failed++
                report(entryId, false)
                step()
            })
    }
    step()
}
