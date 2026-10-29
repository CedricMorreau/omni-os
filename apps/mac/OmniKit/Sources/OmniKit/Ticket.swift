import Foundation

public struct Ticket: Decodable, Hashable, Sendable {
  public struct Gates: Decodable, Hashable, Sendable {
    public let plan: String?
    public let client: String?
    public let go: String?

    public init(plan: String? = nil, client: String? = nil, go: String? = nil) {
      self.plan = plan
      self.client = client
      self.go = go
    }
  }

  public struct Draft: Decodable, Hashable, Sendable {
    public let kind: String
    public let text: String

    enum CodingKeys: String, CodingKey { case kind, text }

    public init(from decoder: any Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? ""
      text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
    }

    public var label: String {
      switch kind {
      case "qa": "QA note"
      case "answer": "Client answer"
      case "closing": "Closing comment"
      default: "Draft"
      }
    }
  }

  public struct RouteProposal: Decodable, Hashable, Sendable {
    public let stages: [Int]
    public let reasons: [String: String]

    enum CodingKeys: String, CodingKey { case stages, reasons }

    public init(stages: [Int], reasons: [String: String] = [:]) {
      self.stages = stages
      self.reasons = reasons
    }

    public init(from decoder: any Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      stages = try c.decodeIfPresent([Int].self, forKey: .stages) ?? []
      reasons = try c.decodeIfPresent([String: String].self, forKey: .reasons) ?? [:]
    }

    public func reason(_ stage: Int) -> String? {
      guard let text = reasons[String(stage)]?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
      return text
    }
  }

  public let threadID: String
  public let ref: String
  public let title: String
  public let channel: String
  public let source: String
  public let link: String?
  public let stage: Int
  public let stageName: String
  public let skipped: [Int]
  public let round: Int
  public let badge: String
  public let waitingDays: Int?
  public let gates: Gates
  public let draft: Draft?
  public let role: String?
  public let route: [Int]?
  public let routeProposal: RouteProposal?
  public let threadStatus: String?
  public let updatedAt: String
  public let closedAt: String?

  enum CodingKeys: String, CodingKey {
    case threadID = "thread_id"
    case ref, title, channel, source, link, stage
    case stageName = "stage_name"
    case skipped, round, badge
    case waitingDays = "waiting_days"
    case gates, draft, role, route
    case routeProposal = "route_proposal"
    case threadStatus = "thread_status"
    case updatedAt = "updated_at"
    case closedAt = "closed_at"
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    threadID = try c.decodeIfPresent(String.self, forKey: .threadID) ?? ""
    ref = try c.decodeIfPresent(String.self, forKey: .ref) ?? ""
    title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
    channel = try c.decodeIfPresent(String.self, forKey: .channel) ?? ""
    source = try c.decodeIfPresent(String.self, forKey: .source) ?? "local"
    link = try c.decodeIfPresent(String.self, forKey: .link)
    let stage = try c.decodeIfPresent(Int.self, forKey: .stage) ?? 0
    self.stage = stage
    let name = try c.decodeIfPresent(String.self, forKey: .stageName)
    stageName = name ?? TicketStage.all.first { $0.number == stage }?.name ?? "Intake"
    skipped = try c.decodeIfPresent([Int].self, forKey: .skipped) ?? []
    round = try c.decodeIfPresent(Int.self, forKey: .round) ?? 1
    badge = try c.decodeIfPresent(String.self, forKey: .badge) ?? "working"
    waitingDays = try c.decodeIfPresent(Int.self, forKey: .waitingDays)
    gates = try c.decodeIfPresent(Gates.self, forKey: .gates) ?? Gates()
    draft = try c.decodeIfPresent(Draft.self, forKey: .draft)
    role = try c.decodeIfPresent(String.self, forKey: .role)
    route = try c.decodeIfPresent([Int].self, forKey: .route)
    routeProposal = try c.decodeIfPresent(RouteProposal.self, forKey: .routeProposal)
    threadStatus = try c.decodeIfPresent(String.self, forKey: .threadStatus)
    updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    closedAt = try c.decodeIfPresent(String.self, forKey: .closedAt)
  }
}

extension Ticket: Identifiable {
  public var id: String { threadID }
  public var phase: TicketPhase { .of(stage: stage, closed: closedAt != nil) }
  public var stageLabel: String { TicketPhase.label(stage: stage, name: stageName, closed: closedAt != nil) }
  public var updated: Date? { OmniJSON.parseDate(updatedAt) }
}

public enum TicketPhase: String, CaseIterable, Hashable, Sendable {
  case neutral, discover, build, manualTest, client, deploy, closing

  public static func of(stage: Int, closed: Bool = false) -> TicketPhase {
    if closed { return .neutral }
    switch stage {
    case 1, 2: return .discover
    case 3...5: return .build
    case 6: return .manualTest
    case 7, 8: return .client
    case 9: return .deploy
    case 10: return .closing
    default: return .neutral
    }
  }

  public static func label(stage: Int, name: String, closed: Bool) -> String {
    if closed { return "Closed" }
    guard (1...TicketStage.all.count).contains(stage) else { return "Intake" }
    let shown = name.isEmpty ? TicketStage.all[stage - 1].name : name
    return "\(stage) · \(shown)"
  }
}

public enum TicketBoard {
  public struct Section: Hashable, Sendable, Identifiable {
    public let stage: Int
    public let title: String
    public let tickets: [Ticket]
    public var id: Int { stage }
    public var phase: TicketPhase { .of(stage: stage) }
  }

  public static func sections(_ tickets: [Ticket]) -> [Section] {
    let open = tickets.filter { $0.closedAt == nil }
    return (0...TicketStage.all.count).compactMap { stage in
      let here = open.filter { min(max($0.stage, 0), TicketStage.all.count) == stage }
        .sorted { ($0.updated ?? .distantPast) > ($1.updated ?? .distantPast) }
      guard !here.isEmpty else { return nil }
      let title = stage == 0 ? "Intake" : "\(stage) \(TicketStage.all[stage - 1].name)"
      return Section(stage: stage, title: title, tickets: here)
    }
  }

  public static func others(_ threads: [OmniThread], tickets: [Ticket]) -> [OmniThread] {
    let ids = Set(tickets.map(\.threadID))
    return threads.filter { !ids.contains($0.id) }
  }
}

public enum TicketRoute {
  public enum Mode: Hashable, Sendable {
    case reading
    case proposed(Ticket.RouteProposal)
    case set([Int])
  }

  public enum StageState: Hashable, Sendable {
    case done, current, ahead, off
  }

  public static func mode(_ ticket: Ticket) -> Mode {
    if let proposal = ticket.routeProposal { return .proposed(proposal) }
    if let route = ticket.route { return .set(route) }
    return .reading
  }

  public static func state(of stage: Int, in ticket: Ticket) -> StageState {
    let route = ticket.route ?? ticket.routeProposal?.stages ?? []
    guard route.contains(stage), !ticket.skipped.contains(stage) else { return .off }
    if ticket.closedAt != nil { return .done }
    if stage == ticket.stage { return .current }
    return stage < ticket.stage ? .done : .ahead
  }

  public static func summary(_ ticket: Ticket) -> String? {
    guard let stages = ticket.route ?? ticket.routeProposal?.stages else { return nil }
    return summary(count: Set(stages).count)
  }

  public static func summary(count: Int) -> String {
    "\(count) of \(TicketStage.all.count) stages"
  }

  public static func canClose(_ ticket: Ticket) -> Bool {
    guard ticket.closedAt == nil, let last = ticket.route?.last else { return false }
    return ticket.stage == last
  }

  public static func header(_ ticket: Ticket) -> [String] {
    var parts: [String] = []
    if !ticket.ref.isEmpty { parts.append(ticket.ref) }
    if ticket.round > 1 { parts.append("Round \(ticket.round)") }
    parts.append(ticket.closedAt == nil ? ticket.stageName : "Closed")
    if let summary = summary(ticket) { parts.append(summary) }
    return parts
  }
}

public struct TicketRouteDraft: Hashable, Sendable {
  public private(set) var stages: Set<Int>

  public init(_ stages: [Int]) {
    self.stages = Set(stages.filter { (1...TicketStage.all.count).contains($0) })
  }

  public func contains(_ stage: Int) -> Bool { stages.contains(stage) }

  public mutating func toggle(_ stage: Int) {
    guard (1...TicketStage.all.count).contains(stage) else { return }
    if stages.contains(stage) { stages.remove(stage) } else { stages.insert(stage) }
  }

  public var canSave: Bool { !stages.isEmpty }

  public var sorted: [Int] { stages.sorted() }
}

private struct CloseBody: Encodable, Sendable {
  let by: String
}

private struct RouteBody: Encodable, Sendable {
  let stages: [Int]
}

extension OmniClient {
  public func ticket(threadID: String) async throws(OmniAPIError) -> Ticket? {
    do {
      return try await send("GET", "/api/tickets/\(uriComponent(threadID))")
    } catch .http(status: 404, _) {
      return nil
    }
  }

  public func tickets(channel: String) async throws(OmniAPIError) -> [Ticket] {
    try await send("GET", "/api/tickets", query: [("channel", channel)])
  }

  public func setTicketRoute(threadID: String, stages: [Int]) async throws(OmniAPIError) -> Ticket {
    try await send("POST", "/api/tickets/\(uriComponent(threadID))/route", body: RouteBody(stages: stages))
  }

  public func closeTicket(threadID: String) async throws(OmniAPIError) -> Ticket {
    try await send("POST", "/api/tickets/\(uriComponent(threadID))/close", body: CloseBody(by: "user"))
  }
}
