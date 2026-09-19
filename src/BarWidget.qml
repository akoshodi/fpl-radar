import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Always-visible bar widget: live points + deadline countdown.
// Keeps the Phase-1 contract (no network calls here — only bindings to
// Model.js cached state plus two local Timers): a 1s tick that just
// re-evaluates text bindings, and a 60s nudge that asks Model.js to
// refresh IF due (Model.js no-ops outside the live window / fresh TTLs,
// so this costs nothing most of the time).
BarWidget {
    id: root
    moduleName: "akoshodi.fplradar"

    // Incremented every second; passed to Model getters purely to force
    // binding re-evaluation (the value never affects results).
    property int tick: 0

    // Icon-only pill: a football glyph (fa-futbol-o, verified present in
    // the bar's Nerd Font via String.fromCharCode to avoid encoding risk).
    // Points and deadline live one click away in the panel header; hover
    // shows them as a tooltip. Still turns urgent-red while live.
    readonly property string pillIcon: String.fromCharCode(0xF1E3)
    readonly property string pillText: pillIcon
    readonly property bool pillLive: Model.isLive(tick)

    function refresh() {
        Model.refreshAll()
        tick++
    }

    function togglePanel() {
        if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
    }

    // Shape contract for shell.summon/hide/toggle routing
    // (Bar.findPanelWidget requires open/close/opened on the root).
    readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
    function open() {
        if (panelLoader.item && panelLoader.item.open) panelLoader.item.open()
    }
    function close() {
        if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
    }
    readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
    function closeForPopoutSwitch() {
        if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
    }

    function injectPanel() {
        var target = panelLoader.item
        if (!target) return
        if ("bar" in target) target.bar = root.bar
        if ("settings" in target) target.settings = root.settings
        if ("anchorItem" in target) target.anchorItem = button
        if ("hostWidget" in target) target.hostWidget = root
    }

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    onBarChanged: injectPanel()
    onSettingsChanged: injectPanel()

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

    Loader {
        id: panelLoader
        active: true
        source: Qt.resolvedUrl("Panel.qml")
        visible: false
        onLoaded: {
            root.injectPanel()
            Qt.callLater(root.injectPanel)
        }
    }

    // Standard route so the shell (and remote debugging) can drive the
    // widget the same way every other bar widget works. Clock pattern.
    IpcHandler {
        target: "akoshodi.fplradar"

        function refresh(): void { root.broadcast("refresh") }
        function open(): void { root.open() }
        function close(): void { root.close() }
        function show(): void { root.open() }
        function hide(): void { root.close() }
        function toggle(): void { root.togglePanel() }
    }

    WidgetButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: root.pillText
        active: root.pillLive
        tooltipText: Model.liveSummaryText(root.tick) + "  •  " + Model.deadlineText(root.tick)
        onPressed: function (b) {
            if (b === Qt.MiddleButton) root.refresh()
            else root.togglePanel()
        }
    }
}
