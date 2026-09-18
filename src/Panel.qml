import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Expanded panel: settings, squad news, chips, price watch, top-manager
// insights. Renders only what Model.js hands it — no aggregation logic,
// no network calls here. Sections that depend on not-yet-implemented
// phases show an explicit "coming in Phase N" placeholder instead of a
// blank gap (graceful degrade by construction).
Panel {
    id: root
    moduleName: "akoshodi.fplradar"
    ipcTarget: "akoshodi.fplradar"
    manageIpc: false

    property var anchorItem: null
    property var hostWidget: null
    readonly property var barIdentity: hostWidget || root

    // Theme, guarded so the panel renders before the bar is injected.
    readonly property color contentForeground: bar ? bar.foreground : Color.foreground
    readonly property color dimForeground: bar ? Qt.darker(bar.foreground, 1.55) : Qt.darker(Color.foreground, 1.55)
    readonly property color urgentColor: bar ? bar.urgent : Color.urgent
    readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

    // Force re-evaluation of Model getters while the panel sits open
    // (countdown text, freshly arrived fetches). Model.refreshAll() only
    // fetches when a TTL is stale, so this stays cheap.
    property int tick: 0
    Timer {
        interval: 1000
        running: opened
        repeat: true
        onTriggered: root.tick++
    }
    Timer {
        interval: 60000
        running: opened
        repeat: true
        onTriggered: Model.refreshAll()
    }

    // Push shell.json-backed widget settings into Model on open / change,
    // and seed the editor fields from them.
    property string entryField: ""
    property string leagueField: ""
    property string sampleField: ""
    property string settingsFeedback: ""

    function syncSettingsFromHost() {
        var entryId = setting("entryId", "")
        var leagueId = setting("leagueId", 314)
        var sampleSize = setting("topManagerSampleSize", 50)
        Model.setEntryId(entryId === "" || entryId === null ? null : entryId)
        Model.setLeagueId(leagueId)
        Model.setTopManagerSampleSize(sampleSize)
        entryField = entryId !== null && entryId !== undefined ? String(entryId) : ""
        leagueField = String(leagueId)
        sampleField = String(Model.state ? Model.state.settings.topManagerSampleSize : sampleSize)
        settingsFeedback = ""
    }

    function saveSettings() {
        if (!bar || !bar.shell || typeof bar.shell.updateEntryInline !== "function") {
            settingsFeedback = "Settings save needs the shell host — values kept for this session only."
            Model.setEntryId(entryField === "" ? null : entryField)
            return
        }
        var entry = { id: moduleName }
        for (var key in settings) if (key !== "id") entry[key] = settings[key]
        entry.entryId = entryField === "" ? null : Number(entryField)
        entry.leagueId = Number(leagueField) || 314
        entry.topManagerSampleSize = Model._clampSampleSize(Number(sampleField) || 50)
        settings = entry
        bar.shell.updateEntryInline(moduleName, entry)
        syncSettingsFromHost()
        settingsFeedback = "Saved — refreshing…"
        Model.refreshAll()
    }

    function refresh() {
        tick++
        Model.refreshAll()
    }

    function open() {
        syncSettingsFromHost()
        refresh()
        controller.show()
    }

    Component.onCompleted: {
        syncSettingsFromHost()
        Model.refreshAll()
    }
    onSettingsChanged: syncSettingsFromHost()

    // Panel content. Width follows the shell popup; height is content-driven.
    Column {
        id: content
        spacing: Style.space(14)
        padding: Style.space(14)
        width: root.width > 0 ? root.width : 380

        // --- Header: live summary + freshness ---
        Column {
            spacing: Style.space(4)
            width: parent.width - Style.space(28)
            Text {
                textFormat: Text.PlainText
                text: Model.liveSummaryText(root.tick)
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.title
                font.bold: true
            }
            Text {
                textFormat: Text.PlainText
                text: Model.deadlineText(root.tick) + Model.staleText(root.tick)
                color: Model.deadlineColor(root.tick)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
            }
        }

        // --- Settings: Team ID / League ID / sample size ---
        Column {
            spacing: Style.space(6)
            width: parent.width - Style.space(28)
            PanelSectionHeader {
                text: "Settings"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Row {
                spacing: Style.space(8)
                Text {
                    textFormat: Text.PlainText
                    text: "Team ID"
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    anchors.verticalCenter: parent.verticalCenter
                    width: 90
                }
                TextField {
                    id: entryInput
                    width: 120
                    text: root.entryField
                    placeholderText: "e.g. 123456"
                    inputMethodHints: Qt.ImhDigitsOnly
                    onTextChanged: root.entryField = text
                    onAccepted: root.saveSettings()
                }
            }
            Row {
                spacing: Style.space(8)
                Text {
                    textFormat: Text.PlainText
                    text: "League ID"
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    anchors.verticalCenter: parent.verticalCenter
                    width: 90
                }
                TextField {
                    width: 120
                    text: root.leagueField
                    placeholderText: "314 = Overall"
                    inputMethodHints: Qt.ImhDigitsOnly
                    onTextChanged: root.leagueField = text
                    onAccepted: root.saveSettings()
                }
            }
            Row {
                spacing: Style.space(8)
                Text {
                    textFormat: Text.PlainText
                    text: "Top-N"
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    anchors.verticalCenter: parent.verticalCenter
                    width: 90
                }
                TextField {
                    width: 120
                    text: root.sampleField
                    placeholderText: "50 (max 200)"
                    inputMethodHints: Qt.ImhDigitsOnly
                    onTextChanged: root.sampleField = text
                    onAccepted: root.saveSettings()
                }
            }
            Row {
                spacing: Style.space(8)
                Button {
                    text: "Save & refresh"
                    onClicked: root.saveSettings()
                }
                Text {
                    visible: root.settingsFeedback !== ""
                    textFormat: Text.PlainText
                    text: root.settingsFeedback
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                    anchors.verticalCenter: parent.verticalCenter
                }
            }
        }

        // --- Squad news (Phase 2) ---
        Column {
            spacing: Style.space(6)
            width: parent.width - Style.space(28)
            PanelSectionHeader {
                text: "Squad News"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Text {
                visible: Model.squadNewsState() === "need-id"
                textFormat: Text.PlainText
                text: "Set your Team ID above to see flags for your 15."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                visible: Model.squadNewsState() === "loading"
                textFormat: Text.PlainText
                text: "Loading squad news…"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
            }
            Text {
                visible: Model.squadNewsState() === "ready" && Model.squadNews().length === 0
                textFormat: Text.PlainText
                text: "All clear — no injury, doubt, or suspension flags in your squad."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Repeater {
                model: Model.squadNews()
                delegate: Column {
                    spacing: 2
                    width: parent.width
                    Text {
                        textFormat: Text.PlainText
                        text: (modelData.onBench ? "🪑 " : "") + modelData.playerName + " — " + modelData.statusLabel + (modelData.isCaptain ? " (C)" : "") + (modelData.isViceCaptain ? " (V)" : "")
                        color: (modelData.status === "s" || modelData.status === "u") ? root.urgentColor : root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.body
                        font.bold: true
                    }
                    Text {
                        textFormat: Text.PlainText
                        text: modelData.note + (modelData.chanceOfPlaying !== null ? " (" + modelData.chanceOfPlaying + "%)" : "")
                        color: root.dimForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.bodySmall
                        wrapMode: Text.WordWrap
                        width: parent.width
                    }
                }
            }
        }

        // --- Chips (Phase 2) ---
        Column {
            spacing: Style.space(6)
            width: parent.width - Style.space(28)
            PanelSectionHeader {
                text: "Chips"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Text {
                visible: Model.chipState() === "need-id"
                textFormat: Text.PlainText
                text: "Set your Team ID above to track chip usage."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
            }
            Text {
                visible: Model.chipState() === "loading"
                textFormat: Text.PlainText
                text: "Loading chips…"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
            }
            Text {
                visible: Model.chipState() === "ready"
                textFormat: Text.PlainText
                text: Model.chipSummaryText()
                color: root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                font.bold: true
            }
            Repeater {
                model: Model.chipStatus()
                delegate: Text {
                    textFormat: Text.PlainText
                    text: (modelData.used ? "✓ " : "○ ") + modelData.name + (modelData.used && modelData.usedEvent !== null ? " — used GW" + modelData.usedEvent : ": available")
                    color: modelData.used ? root.dimForeground : root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                }
            }
        }

        // --- Price watch (Phase 3 — placeholder, not blank) ---
        Column {
            spacing: Style.space(6)
            width: parent.width - Style.space(28)
            PanelSectionHeader {
                text: "Price Watch"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Text {
                textFormat: Text.PlainText
                text: "Coming in Phase 3 — day-over-day price/transfer tracking."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }

        // --- Top Manager Insights (Phase 4 — placeholder, not blank) ---
        Column {
            spacing: Style.space(6)
            width: parent.width - Style.space(28)
            PanelSectionHeader {
                text: "Top Manager Insights (GW " + Model.analysisGameweek() + ", sample " + Model.analysisSampleSize() + ")"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Text {
                textFormat: Text.PlainText
                text: "Coming in Phase 4 — captaincy consensus and elite differentials from top managers."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }
    }
}
