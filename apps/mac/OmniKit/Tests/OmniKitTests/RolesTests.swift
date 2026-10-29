import Foundation
import Testing
import OmniKit

@Suite struct RolesTests {
  static let roleJSON = #"{"id":"reviewer","name":"Reviewer","description":"Reviews","mcp":[],"skills":["ponytail:ponytail-review","code-review"],"stages":[5],"source":"yours","charter":"Review the diff."}"#

  @Test func decodesTheNewRoleFields() throws {
    let role = try decode(CrewRole.self, Self.roleJSON)
    #expect(role.skills == ["ponytail:ponytail-review", "code-review"])
    #expect(role.stages == [5])
    #expect(role.source == .yours)
    #expect(role.charter == "Review the diff.")
  }

  @Test func decodesAnOldRoleWithDefaults() throws {
    let role = try decode(CrewRole.self, #"{"id":"builder","name":"Builder","mcp":[],"charter":""}"#)
    #expect(role.skills.isEmpty)
    #expect(role.stages.isEmpty)
    #expect(role.source == .shipped)
  }

  @Test func decodesTheFixture() throws {
    let crew = try decodeFixture([CrewRole].self, "crew.json")
    #expect(crew.allSatisfy { $0.source == .shipped })
    #expect(Roles.others(in: crew).map(\.id).contains("conductor") == false)
  }

  @Test func groupsRolesByStageAndHidesSystemRoles() throws {
    let reviewer = try decode(CrewRole.self, Self.roleJSON)
    let ticket = try decode(CrewRole.self, #"{"id":"ticket","name":"Ticket","stages":[5],"source":"yours"}"#)
    let loose = try decode(CrewRole.self, #"{"id":"loose","name":"Loose","source":"yours"}"#)
    let crew = [reviewer, ticket, loose]
    #expect(Roles.at(5, in: crew).map(\.id) == ["reviewer"])
    #expect(Roles.others(in: crew).map(\.id) == ["loose"])
    #expect(Roles.canDelete(reviewer))
    #expect(!Roles.canDelete(ticket))
  }

  @Test func makesASlugFromTheName() {
    #expect(Roles.slug("Code Reviewer") == "code-reviewer")
    #expect(Roles.slug("  Préview + QA!  ") == "preview-qa")
    #expect(Roles.isValidID("code-reviewer"))
    #expect(!Roles.isValidID("-bad"))
    #expect(!Roles.isValidID("Bad"))
  }

  @Test func createsARole() async throws {
    let t = StubTransport(body: Self.roleJSON)
    var draft = RoleDraft()
    draft.name = "Reviewer"
    draft.id = "reviewer"
    draft.charter = "Review the diff."
    draft.addSkill("code-review")
    draft.addSkill("code-review")
    draft.stages = [5]
    let role = try await OmniClient(port: 4799, transport: t).createRole(draft.input)
    #expect(role.id == "reviewer")
    #expect(t.requests[0].httpMethod == "POST")
    #expect(t.requests[0].url?.path == "/api/crew")
    #expect(try bodyJSON(t.requests[0]) == .object([
      "id": .string("reviewer"), "name": .string("Reviewer"), "description": .string(""),
      "skills": .array([.string("code-review")]), "stages": .array([.number(5)]), "charter": .string("Review the diff."),
    ]))
  }

  @Test func updatesARoleWithoutTheID() async throws {
    let t = StubTransport(body: Self.roleJSON)
    var draft = RoleDraft(try decode(CrewRole.self, Self.roleJSON))
    draft.name = "Code reviewer"
    _ = try await OmniClient(port: 4799, transport: t).updateRole("reviewer", draft.input)
    #expect(t.requests[0].httpMethod == "PUT")
    #expect(t.requests[0].url?.path == "/api/crew/reviewer")
    #expect(try bodyJSON(t.requests[0]) == .object([
      "name": .string("Code reviewer"), "description": .string("Reviews"),
      "skills": .array([.string("ponytail:ponytail-review"), .string("code-review")]), "stages": .array([.number(5)]),
      "charter": .string("Review the diff."),
    ]))
  }

  @Test func deletesARole() async throws {
    let t = StubTransport(body: #"{"ok":true}"#)
    try await OmniClient(port: 4799, transport: t).deleteRole("reviewer")
    #expect(t.requests[0].httpMethod == "DELETE")
    #expect(t.requests[0].url?.path == "/api/crew/reviewer")
    #expect(t.requests[0].httpBody == nil)
  }

  @Test func matchesSkillsByPrefixFirst() {
    let names = ["code-review", "ponytail:ponytail-review", "review-pr"]
    #expect(Roles.matches("review", in: names, excluding: ["code-review"]) == ["review-pr", "ponytail:ponytail-review"])
  }
}
