import Foundation
import Testing
import OmniKit

// packages/test-fixtures/settings-catalog.json is written from packages/shared/settings-catalog.ts and checked by
// packages/shared/tests/settings-catalog.test.ts, so the Settings window cannot drift from the web's nav and search.

private let repoRoot = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

private struct Fixture: Decodable {
  struct Search: Decodable {
    let query: String
    let surface: String
    let expected: [String]
  }
  let groups: [SettingsCatalog.Group]
  let sections: [SettingsCatalog.Section]
  let entries: [SettingsCatalog.Entry]
  let legacy: [String: String]
  let searches: [Search]
}

@Suite struct SettingsCatalogTests {
  private func fixture() throws -> Fixture {
    try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: repoRoot.appending(path: "packages/test-fixtures/settings-catalog.json")))
  }

  @Test func matchesTheSharedCatalog() throws {
    let f = try fixture()
    #expect(SettingsCatalog.groups == f.groups)
    #expect(SettingsCatalog.sections == f.sections)
    #expect(SettingsCatalog.entries == f.entries)
    #expect(SettingsCatalog.legacy == f.legacy)
  }

  @Test func searchesLikeTheWeb() throws {
    for s in try fixture().searches {
      #expect(SettingsCatalog.search(s.query, surface: s.surface).map(\.id) == s.expected, "\(s.query) on \(s.surface)")
    }
  }

  @Test func everySectionIsATab() {
    for s in SettingsCatalog.sections { #expect(SettingsTab(rawValue: s.id) != nil, "\(s.id)") }
  }
}

@Suite struct ProvenanceTests {
  @Test func anEnvVarWinsOverTheFile() {
    let (p, label) = Provenance.of(field: "user.timezone", saved: "Europe/London", default: "", env: ["user.timezone": "OMNI_TZ"])
    #expect(p == .env)
    #expect(label == "Set by OMNI_TZ")
    #expect(!p.resettable)
  }

  @Test func aSavedValueIsThisMachinesAndTheDefaultIsBuiltIn() {
    #expect(Provenance.of(field: "user.email", saved: "ada@example.com", default: "", env: nil).0 == .machine)
    #expect(Provenance.of(field: "user.pronouns", saved: "they/them", default: "they/them", env: [:]).0 == .default)
    #expect(Provenance.machine.resettable && Provenance.channel.resettable)
  }
}
