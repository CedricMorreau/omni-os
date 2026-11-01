import Foundation

/// A section of the Settings window: the same sections, groups and order as the Web UI's Settings nav and the
/// phone's Settings screen (packages/shared/settings-catalog.ts, mirrored in SettingsCatalog.swift). Automations is
/// a page of the main window, as on the web.
public enum SettingsTab: String, CaseIterable, Hashable, Sendable {
  case general, appearance, notifications
  case models, threads
  case channels, workspace, worktrees
  case machines, sync, access, integrations, secrets
  case about

  /// The section by name, taking the names it had before (the eight tabs before #404, the four after it and
  /// "connection", older still) so a QA script or link written for one opens the section that holds that page now.
  public init?(named name: String) {
    if let tab = SettingsTab(rawValue: name) {
      self = tab
      return
    }
    guard let id = SettingsCatalog.legacy[name], let tab = SettingsTab(rawValue: id) else { return nil }
    self = tab
  }

  public var section: SettingsCatalog.Section { SettingsCatalog.section(rawValue) }
}

extension Route {
  /// The Settings tab a route opens instead of a screen of the main window: `#/settings` and its sections, and
  /// the pages Settings replaced (`#/secrets`, `#/sync`, `#/storage`).
  public var settingsTab: SettingsTab? {
    if case .settings(let tab) = self { return tab }
    return nil
  }
}

extension AppModel {
  /// Goes to `route`, or picks its Settings tab and keeps the route when it lives in Settings. Returns that
  /// tab, so the caller opens the Settings window.
  @discardableResult
  public func show(_ route: Route) -> SettingsTab? {
    guard let tab = route.settingsTab else {
      self.route = route
      return nil
    }
    settingsTab = tab
    return tab
  }
}
