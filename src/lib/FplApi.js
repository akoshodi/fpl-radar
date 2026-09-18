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

// TODO(agent): add fetchLeagueStandings(leagueId, sampleSize, onSuccess, onError)
// that pages through fetchLeagueStandingsPage() until `sampleSize` entries are
// collected, and fetchPicksForManagers(entryIds, gameweek, onProgress, onDone)
// that throttles calls to fetchPicks() per the spacing guidance in
// docs/DATA_SOURCES.md (don't fire all requests concurrently).
