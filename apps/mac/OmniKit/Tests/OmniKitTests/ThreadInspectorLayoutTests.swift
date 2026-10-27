import Testing
import OmniKit

@Suite struct ThreadInspectorLayoutTests {
  @Test func docksWhileTheThreadHasRoom() {
    let layout = ThreadInspectorLayout(paneWidth: 1200, requestedPanelWidth: 360)
    #expect(layout.threadWidth == 840)
    #expect(layout.panelWidth == 360)
    #expect(layout.overlap == 0)
  }

  @Test func growingPastTheThresholdCoversTheThreadWithoutReflowingIt() {
    let docked = ThreadInspectorLayout(paneWidth: 1200, requestedPanelWidth: 640)
    let overlapping = ThreadInspectorLayout(paneWidth: 1200, requestedPanelWidth: 800)
    let maximum = ThreadInspectorLayout(paneWidth: 1200, requestedPanelWidth: 2000)
    #expect(docked.threadWidth == 560)
    #expect(docked.overlap == 0)
    #expect(overlapping.threadWidth == docked.threadWidth)
    #expect(overlapping.overlap == 160)
    #expect(maximum.threadWidth == docked.threadWidth)
    #expect(maximum.panelWidth == 960)
    #expect(maximum.overlap == 320)
  }

  @Test func narrowThreadWindowKeepsItsContentReadableAtEightyPercent() {
    let layout = ThreadInspectorLayout(paneWidth: 780, requestedPanelWidth: 624)
    #expect(layout.panelWidth == 624)
    #expect(layout.threadWidth == 560)
    #expect(layout.overlap == 404)
  }

  @Test func resizingThePaneClampsThePanelAndPreservesTheThread() {
    let layout = ThreadInspectorLayout(paneWidth: 600, requestedPanelWidth: 960)
    #expect(layout.panelWidth == 480)
    #expect(layout.threadWidth == 560)
    #expect(layout.overlap == 440)
    let tiny = ThreadInspectorLayout(paneWidth: 400, requestedPanelWidth: 960)
    #expect(tiny.panelWidth == 320)
    #expect(tiny.threadWidth == 400)
    #expect(tiny.overlap == 320)
  }
}
