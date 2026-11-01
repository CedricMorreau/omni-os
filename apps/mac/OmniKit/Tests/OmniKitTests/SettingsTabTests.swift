import Foundation
import Testing
import OmniKit

@MainActor
@Suite struct SettingsTabTests {
  private func model() -> (AppModel, TempDir) {
    let dir = TempDir("settingstab")
    let settings = ServerSettings(defaults: UserDefaults(suiteName: "settingstab-\(UUID().uuidString)")!, arguments: [:])
    let supervisor = ServerSupervisor(
      settings: settings, options: .init(logURL: dir.path("server.log"), recordURL: dir.path("server.json"))
    )
    let model = AppModel(settings: settings, supervisor: supervisor) { port in
      let client = OmniClient(port: port, transport: StubTransport(body: "[]"))
      let clock = TestClock()
      return AppModel.Connection(
        client: client, store: WorkspaceStore(api: client, clock: clock),
        feed: AppFeed(source: client.feedEvents(transport: ScriptedSSETransport(), clock: clock)))
    }
    return (model, dir)
  }

  @Test func settingsRoutesLiveInSettings() {
    #expect(Route.settings(.secrets).settingsTab == .secrets)
    #expect(Route.settings(.general).settingsTab == .general)
    #expect(Route(hash: "#/settings").settingsTab == .general)
    #expect(Route(hash: "#/sync").settingsTab == .sync)
    #expect(Route(hash: "#/storage").settingsTab == .worktrees)
    #expect(Route(hash: "#/settings/storage").settingsTab == .worktrees)
    #expect(Route(hash: "#/settings/threads").settingsTab == .threads)
    for route: Route in [.home, .artifacts, .automations, .newChannel, .channel(id: "acme"), .search(query: "x")] {
      #expect(route.settingsTab == nil, "\(route)")
    }
  }

  @Test func opensSecretsInSettingsAndKeepsTheRoute() {
    let (model, dir) = model()
    defer { dir.remove() }
    #expect(model.settingsTab == .general)
    model.route = .channel(id: "acme")
    #expect(model.show(.settings(.secrets)) == .secrets)
    #expect(model.route == .channel(id: "acme"))
    #expect(model.settingsTab == .secrets)
  }

  @Test func goesToAnyOtherRoute() {
    let (model, dir) = model()
    defer { dir.remove() }
    #expect(model.show(.artifacts) == nil)
    #expect(model.route == .artifacts)
    #expect(model.settingsTab == .general)
  }

  /// The same sections as the web's nav, in the same order; ⌘, and the sidebar both start on General.
  @Test func hasTheWebsSections() {
    #expect(SettingsTab.allCases.map(\.rawValue) == SettingsCatalog.sections.map(\.id))
  }

  /// A QA script written for an older tab opens the section that holds that page now.
  @Test func takesTheOldTabNames() {
    #expect(SettingsTab(named: "general") == .general)
    #expect(SettingsTab(named: "machines") == .machines)
    for old in ["profile", "quickPrompt"] { #expect(SettingsTab(named: old) == .general, "\(old)") }
    #expect(SettingsTab(named: "notifications") == .notifications)
    #expect(SettingsTab(named: "appearance") == .appearance)
    for old in ["server", "connection"] { #expect(SettingsTab(named: old) == .machines, "\(old)") }
    #expect(SettingsTab(named: "sync") == .sync)
    #expect(SettingsTab(named: "storage") == .worktrees)
    #expect(SettingsTab(named: "garage") == nil)
  }

  @Test func aSettingsRouteIsNoStopInTheHistory() {
    let (model, dir) = model()
    defer { dir.remove() }
    model.route = .channel(id: "acme")
    // What the main window does when a script sets #/settings/secrets: put the old route back.
    model.route = .settings(.secrets)
    model.route = .channel(id: "acme")
    #expect(model.shell.history.canGoBack)
    #expect(model.shell.history.current == .channel(id: "acme"))
    #expect(model.shell.history.entries == [.home, .channel(id: "acme")])
  }
}
