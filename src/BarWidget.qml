import QtQuick 2.15
import "Model.js" as Model

// Always-visible bar widget. Keeps the Phase-1 contract: no network calls
// here, only bindings to Model.js cached state plus two local Timers
// (a 1s tick that just re-evaluates text bindings, and a 60s nudge that
// asks Model.js to refresh IF due — Model.js no-ops outside the live
// window / fresh TTLs, so this costs nothing most of the time).
Row {
    id: root
    spacing: 8

    // Incremented every second; passed to Model getters purely to force
    // binding re-evaluation (the value never affects results).
    property int tick: 0

    Component.onCompleted: {
        Model.init()
    }

    // Cheap 1s countdown tick — local calc only, no network.
    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: root.tick++
    }

    // Live-points poll nudge — Model.refreshAll() only fetches when a TTL
    // is stale (live endpoint: only while a gameweek is actually live).
    Timer {
        interval: 60000
        running: true
        repeat: true
        onTriggered: Model.refreshAll()
    }

    Text {
        // e.g. "GW7 Live: 62 pts" — green while live, grey otherwise.
        text: Model.liveSummaryText(root.tick)
        color: Model.isLive(root.tick) ? "#2ecc71" : "#cccccc"
    }

    Text {
        // e.g. "Deadline: 1h 42m" — turns amber/red as it closes in.
        text: Model.deadlineText(root.tick)
        color: Model.deadlineColor(root.tick)
    }

    MouseArea {
        anchors.fill: parent
        onClicked: Model.togglePanel()
    }
}
