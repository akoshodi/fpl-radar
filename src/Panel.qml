import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "Model.js" as Model

// FPL Radar panel: tabbed views (Team / Prices / Insights) plus a dedicated
// Settings page behind the gear button. Renders only what Model.js hands
// it — no aggregation logic, no network calls here.
//
// Reactivity note: QML evaluates a binding ONCE unless it references a
// changing property. Every Model.*() call below takes root.tick so all
// sections re-evaluate each second while open (the argument is ignored by
// the getters). Without it, sections freeze in their at-open state.
Panel {
    id: root
    moduleName: "akoshodi.fplradar"
    ipcTarget: "akoshodi.fplradar"
    manageIpc: false

    property var anchorItem: null
    property var hostWidget: null
    readonly property var barIdentity: hostWidget || root

    // Visible view: team | prices | insights | settings.
    property string view: "team"

    // Theme, guarded so the panel renders before the bar is injected.
    readonly property color contentForeground: bar ? bar.foreground : Color.foreground
    readonly property color dimForeground: bar ? Qt.darker(bar.foreground, 1.55) : Qt.darker(Color.foreground, 1.55)
    readonly property color urgentColor: bar ? bar.urgent : Color.urgent
    readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

    // Ticks all Model bindings below (see note above). Model.refreshAll()
    // only fetches when a TTL is stale, so this stays cheap.
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
        // Keep the host bar-widget's copy in step (clock pattern) so the
        // bar and panel never disagree about the configured IDs.
        if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
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

    KeyboardPanel {
        id: panel
        anchorItem: root.anchorItem
        owner: root.barIdentity
        bar: root.bar
        open: root.opened
        centerOnBar: true
        focusTarget: keyCatcher
        contentWidth: panel.fittedContentWidth(Style.space(420))
        contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight)

        PanelKeyCatcher {
            id: keyCatcher
            anchors.fill: parent
            onCloseRequested: root.close()
            onTabRequested: function(direction) { root.switchPanel(direction) }

            Flickable {
                id: contentScroll
                anchors.fill: parent
                anchors.margins: Style.space(14)
                contentWidth: width
                contentHeight: contentColumn.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                interactive: contentHeight > height

                Column {
                    id: contentColumn
                    width: contentScroll.width
                    spacing: Style.space(14)

        // --- Tab bar: always visible, doubles as the way back from Settings ---
        Row {
            spacing: Style.space(8)
            Button {
                text: "Team"
                selected: root.view === "team"
                onClicked: root.view = "team"
            }
            Button {
                text: "Prices"
                selected: root.view === "prices"
                onClicked: root.view = "prices"
            }
            Button {
                text: "Insights"
                selected: root.view === "insights"
                onClicked: root.view = "insights"
            }
            Button {
                text: String.fromCharCode(0xF013)
                selected: root.view === "settings"
                tooltipText: "Settings"
                onClicked: root.view = "settings"
            }
        }

        // --- Team view: live header, squad news, chips ---
        Column {
            visible: root.view === "team"
            spacing: Style.space(14)
            width: parent.width

            Column {
                spacing: Style.space(4)
                width: parent.width
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

            Column {
                spacing: Style.space(6)
                width: parent.width
                PanelSectionHeader {
                    text: "Squad News"
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                }
                Text {
                    visible: Model.squadNewsState(root.tick) === "need-id"
                    textFormat: Text.PlainText
                    text: "Set your Team ID in Settings (gear above) to see flags for your 15."
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
                Text {
                    visible: Model.squadNewsState(root.tick) === "loading"
                    textFormat: Text.PlainText
                    text: "Loading squad news…"
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                }
                Text {
                    visible: Model.squadNewsState(root.tick) === "ready" && Model.squadNews(root.tick).length === 0
                    textFormat: Text.PlainText
                    text: "All clear — no injury, doubt, or suspension flags in your squad."
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
                Repeater {
                    model: Model.squadNews(root.tick)
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

            Column {
                spacing: Style.space(6)
                width: parent.width
                PanelSectionHeader {
                    text: "Chips"
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                }
                Text {
                    visible: Model.chipState(root.tick) === "need-id"
                    textFormat: Text.PlainText
                    text: "Set your Team ID in Settings to track chip usage."
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                }
                Text {
                    visible: Model.chipState(root.tick) === "loading"
                    textFormat: Text.PlainText
                    text: "Loading chips…"
                    color: root.dimForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                }
                Text {
                    visible: Model.chipState(root.tick) === "ready"
                    textFormat: Text.PlainText
                    text: Model.chipSummaryText(root.tick)
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                }
                Repeater {
                    model: Model.chipStatus(root.tick)
                    delegate: Text {
                        textFormat: Text.PlainText
                        text: (modelData.used ? "✓ " : "○ ") + modelData.name + (modelData.used && modelData.usedEvent !== null ? " — used GW" + modelData.usedEvent : ": available")
                        color: modelData.used ? root.dimForeground : root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.body
                    }
                }
            }
        }

        // --- Prices view ---
        Column {
            visible: root.view === "prices"
            spacing: Style.space(6)
            width: parent.width
            PanelSectionHeader {
                text: "Price Watch"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Text {
                visible: Model.priceWatchState(root.tick) === "loading"
                textFormat: Text.PlainText
                text: "Loading prices…"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
            }
            Text {
                visible: Model.priceWatchState(root.tick) === "baseline"
                textFormat: Text.PlainText
                text: "Collecting baseline — price moves appear after the next data refresh."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                visible: Model.priceWatchState(root.tick) === "ready" && Model.priceWatch(root.tick).risers.length === 0 && Model.priceWatch(root.tick).fallers.length === 0
                textFormat: Text.PlainText
                text: "No notable price moves since yesterday."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                visible: Model.priceWatch(root.tick).risers.length > 0
                textFormat: Text.PlainText
                text: "Rising"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
            }
            Repeater {
                model: Model.priceWatch(root.tick).risers
                delegate: Text {
                    textFormat: Text.PlainText
                    text: "▲ " + modelData.playerName + (modelData.team !== "" ? " (" + modelData.team + ")" : "") + " " + modelData.cost + " — " + modelData.note
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
            }
            Text {
                visible: Model.priceWatch(root.tick).fallers.length > 0
                textFormat: Text.PlainText
                text: "Falling"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
            }
            Repeater {
                model: Model.priceWatch(root.tick).fallers
                delegate: Text {
                    textFormat: Text.PlainText
                    text: "▼ " + modelData.playerName + (modelData.team !== "" ? " (" + modelData.team + ")" : "") + " " + modelData.cost + " — " + modelData.note
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
            }
        }

        // --- Insights view: what the sampled elites are doing —
        //      descriptive signal ("top managers are favouring…"), never
        //      directives. N + gameweek shown so the weight is clear.
        Column {
            visible: root.view === "insights"
            spacing: Style.space(6)
            width: parent.width
            PanelSectionHeader {
                text: "Top Manager Insights (GW " + Model.analysisGameweek(root.tick) + ", sample " + Model.analysisSampleSize(root.tick) + ")"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
            }
            Text {
                visible: Model.topManagerState(root.tick) === "loading"
                textFormat: Text.PlainText
                text: "Sampling top managers… (once daily, slowest on first run)"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
            }
            Text {
                visible: Model.analysisNote(root.tick) !== ""
                textFormat: Text.PlainText
                text: Model.analysisNote(root.tick)
                color: root.urgentColor
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
            }
            Text {
                visible: Model.topManagerState(root.tick) === "ready" && Model.consensusCaptains(root.tick).length > 0
                textFormat: Text.PlainText
                text: "Top managers are favouring as captain:"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
            }
            Repeater {
                model: Model.consensusCaptains(root.tick)
                delegate: Text {
                    textFormat: Text.PlainText
                    text: modelData.playerName + " — " + modelData.captaincyPct + "% of sample" + (modelData.nextFixture !== "" ? " • " + modelData.nextFixture : "")
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
            }
            Text {
                visible: Model.eliteDifferentialsIn(root.tick).length > 0
                textFormat: Text.PlainText
                text: "Elites own these far above the public (transfer-in candidates):"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
            }
            Repeater {
                model: Model.eliteDifferentialsIn(root.tick)
                delegate: Text {
                    textFormat: Text.PlainText
                    text: modelData.playerName + " — " + modelData.topOwnershipPct + "% top-N vs " + modelData.globalOwnershipPct + "% global"
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
            }
            Text {
                visible: Model.topManagerState(root.tick) === "ready" && !Model.hasOwnSquad(root.tick)
                textFormat: Text.PlainText
                text: "Set your Team ID in Settings to see which of your players the elites are fading."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                visible: Model.hasOwnSquad(root.tick) && Model.eliteDifferentialsOut(root.tick).length > 0
                textFormat: Text.PlainText
                text: "Elites are fading these that you own (transfer-out candidates):"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
            }
            Repeater {
                model: Model.eliteDifferentialsOut(root.tick)
                delegate: Text {
                    textFormat: Text.PlainText
                    text: modelData.playerName + " — " + modelData.topOwnershipPct + "% top-N vs " + modelData.globalOwnershipPct + "% global"
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    wrapMode: Text.WordWrap
                    width: parent.width
                }
            }
            Text {
                visible: Model.hasOwnSquad(root.tick) && Model.topManagerState(root.tick) === "ready" && Model.eliteDifferentialsOut(root.tick).length === 0
                textFormat: Text.PlainText
                text: "None of your players are being faded by the elites."
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                visible: Model.trendRowsIn(root.tick).length > 0 || Model.trendRowsOut(root.tick).length > 0
                textFormat: Text.PlainText
                text: "Week-over-week among elites (soft signal):"
                color: root.dimForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.bodySmall
                font.bold: true
            }
            Repeater {
                model: Model.trendRowsIn(root.tick)
                delegate: Text {
                    textFormat: Text.PlainText
                    text: "▲ " + modelData.playerName + " (+" + modelData.delta + " squads, " + modelData.currPct + "%)"
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                }
            }
            Repeater {
                model: Model.trendRowsOut(root.tick)
                delegate: Text {
                    textFormat: Text.PlainText
                    text: "▼ " + modelData.playerName + " (" + modelData.delta + " squads, " + modelData.currPct + "%)"
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                }
            }
        }

        // --- Settings page (gear): Team ID / League ID / sample size ---
        Column {
            visible: root.view === "settings"
            spacing: Style.space(6)
            width: parent.width
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
                }
            }
        }
    }
}
