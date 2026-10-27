/// Dock the inspector until the thread reaches a readable width, then cover it instead of shrinking it.
/// All dimensions are unzoomed points, including the pane width supplied by the view.
public struct ThreadInspectorLayout: Equatable, Sendable {
  public let minimumPanelWidth: Double
  public let maximumPanelWidth: Double
  public let panelWidth: Double
  public let threadWidth: Double
  public let overlap: Double

  public init(paneWidth: Double, requestedPanelWidth: Double) {
    let pane = max(0, paneWidth)
    maximumPanelWidth = pane * 0.8
    minimumPanelWidth = min(340, maximumPanelWidth)
    panelWidth = min(maximumPanelWidth, max(minimumPanelWidth, requestedPanelWidth))
    threadWidth = min(pane, max(560, pane - panelWidth))
    overlap = max(0, threadWidth + panelWidth - pane)
  }
}
