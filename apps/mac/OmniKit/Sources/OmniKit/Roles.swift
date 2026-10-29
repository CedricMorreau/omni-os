import Foundation

public struct TicketStage: Hashable, Sendable, Identifiable {
  public let number: Int
  public let name: String
  public var id: Int { number }

  public static let all: [TicketStage] = [
    "Research", "Build plan", "Execute", "Test", "Review", "Manual test", "Preview + QA note", "Client approval", "Deploy", "Closing",
  ].enumerated().map { TicketStage(number: $0.offset + 1, name: $0.element) }
}

public enum Roles {
  public static let systemIDs: Set<String> = ["conductor", "ticket"]

  public static func at(_ stage: Int, in crew: [CrewRole]) -> [CrewRole] {
    crew.filter { !systemIDs.contains($0.id) && $0.stages.contains(stage) }
  }

  public static func others(in crew: [CrewRole]) -> [CrewRole] {
    crew.filter { !systemIDs.contains($0.id) && $0.stages.isEmpty }
  }

  public static func canDelete(_ role: CrewRole) -> Bool {
    role.source == .yours && !systemIDs.contains(role.id)
  }

  public static func slug(_ name: String) -> String {
    let folded = name.folding(options: .diacriticInsensitive, locale: nil).lowercased()
    let words = folded.split { !($0.isASCII && ($0.isLetter || $0.isNumber)) }
    return String(words.joined(separator: "-").prefix(40)).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }

  public static func isValidID(_ id: String) -> Bool {
    id.wholeMatch(of: /[a-z0-9][a-z0-9-]{0,39}/) != nil
  }

  public static func skillNames(_ commands: [SlashCommand]) -> [String] {
    Array(Set(commands.filter { $0.source != "omni" }.map(\.name))).sorted()
  }

  public static func matches(_ query: String, in names: [String], excluding taken: [String], limit: Int = 8) -> [String] {
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    let free = names.filter { !taken.contains($0) }
    guard !q.isEmpty else { return Array(free.prefix(limit)) }
    let hits = free.filter { $0.lowercased().contains(q) }
    return Array(hits.sorted { ($0.lowercased().hasPrefix(q) ? 0 : 1, $0) < ($1.lowercased().hasPrefix(q) ? 0 : 1, $1) }.prefix(limit))
  }
}

public struct RoleInput: Encodable, Hashable, Sendable {
  public var id: String?
  public var name: String
  public var description: String
  public var model: String?
  public var skills: [String]
  public var stages: [Int]
  public var charter: String

  public init(
    id: String? = nil, name: String, description: String, model: String? = nil, skills: [String], stages: [Int], charter: String
  ) {
    self.id = id
    self.name = name
    self.description = description
    self.model = model
    self.skills = skills
    self.stages = stages
    self.charter = charter
  }
}

public struct RoleDraft: Hashable, Sendable {
  public let editing: String?
  public var id: String
  public var name: String
  public var description: String
  public var charter: String
  public var skills: [String]
  public var stages: Set<Int>
  public let model: String?

  public init() {
    editing = nil
    id = ""
    name = ""
    description = ""
    charter = ""
    skills = []
    stages = []
    model = nil
  }

  public init(_ role: CrewRole) {
    editing = role.id
    id = role.id
    name = role.name
    description = role.description
    charter = role.charter
    skills = role.skills
    stages = Set(role.stages)
    model = role.model
  }

  public var isNew: Bool { editing == nil }

  public mutating func addSkill(_ raw: String) {
    let skill = raw.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard !skill.isEmpty, !skills.contains(skill) else { return }
    skills.append(skill)
  }

  public var problem: String? {
    if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Give the role a name." }
    if isNew && !Roles.isValidID(id) { return "The id uses lowercase letters, digits and dashes, and starts with a letter or digit." }
    return nil
  }

  public var input: RoleInput {
    RoleInput(
      id: isNew ? id : nil,
      name: name.trimmingCharacters(in: .whitespaces),
      description: description.trimmingCharacters(in: .whitespacesAndNewlines),
      model: model,
      skills: skills,
      stages: stages.sorted(),
      charter: charter
    )
  }
}

private struct OKBody: Decodable {
  let ok: Bool
}

extension OmniClient {
  public func createRole(_ input: RoleInput) async throws(OmniAPIError) -> CrewRole {
    try await send("POST", "/api/crew", body: input)
  }

  public func updateRole(_ id: String, _ input: RoleInput) async throws(OmniAPIError) -> CrewRole {
    var body = input
    body.id = nil
    return try await send("PUT", "/api/crew/\(uriComponent(id))", body: body)
  }

  public func deleteRole(_ id: String) async throws(OmniAPIError) {
    let _: OKBody = try await send("DELETE", "/api/crew/\(uriComponent(id))")
  }
}
