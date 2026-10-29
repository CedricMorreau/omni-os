import Foundation
import Testing
import OmniKit

private let routedJSON = """
  {"thread_id":"t1","ref":"#1060","title":"Fix the cart","channel":"acme","source":"productive","link":"https://app.productive.io/t/1",
   "stage":3,"stage_name":"Execute","skipped":[6],"round":2,"badge":"working","waiting_days":null,
   "gates":{"plan":"2026-10-20T10:00:00.000Z","client":null,"go":null},"draft":null,"role":"builder",
   "route":[1,2,3,4,5,7,8,9,10],"route_proposal":null,"thread_status":"running","updated_at":"2026-10-28T09:00:00.000Z","closed_at":null}
  """

private let proposedJSON = """
  {"thread_id":"t2","ref":"L-001","title":"Copy change","channel":"acme","source":"local","link":null,"stage":0,"stage_name":"Intake",
   "skipped":[],"round":1,"badge":"decide","waiting_days":1,"gates":{"plan":null,"client":null,"go":null},
   "draft":{"kind":"client","text":"Hi"},"role":null,"route":null,
   "route_proposal":{"stages":[1,3,4,9,10],"reasons":{"2":"A one-line change needs no plan.","5":" "}},
   "thread_status":"idle","updated_at":"2026-10-28T09:00:00.000Z","closed_at":null}
  """

@Suite struct TicketTests {
  @Test func decodesATicketWithARoute() throws {
    let t = try decode(Ticket.self, routedJSON)
    #expect(t.threadID == "t1")
    #expect(t.ref == "#1060")
    #expect(t.stage == 3)
    #expect(t.stageName == "Execute")
    #expect(t.round == 2)
    #expect(t.route == [1, 2, 3, 4, 5, 7, 8, 9, 10])
    #expect(t.routeProposal == nil)
    #expect(t.gates.plan == "2026-10-20T10:00:00.000Z")
    #expect(t.draft == nil)
    #expect(TicketRoute.mode(t) == .set([1, 2, 3, 4, 5, 7, 8, 9, 10]))
  }

  @Test func decodesATicketWithAProposal() throws {
    let t = try decode(Ticket.self, proposedJSON)
    #expect(t.route == nil)
    let proposal = try #require(t.routeProposal)
    #expect(proposal.stages == [1, 3, 4, 9, 10])
    #expect(proposal.reason(2) == "A one-line change needs no plan.")
    #expect(proposal.reason(5) == nil)
    #expect(proposal.reason(6) == nil)
    #expect(t.draft?.text == "Hi")
    #expect(t.waitingDays == 1)
    #expect(TicketRoute.mode(t) == .proposed(proposal))
  }

  @Test func fillsDefaultsForMissingFields() throws {
    let t = try decode(Ticket.self, ##"{"thread_id":"t3","ref":"#1"}"##)
    #expect(t.stage == 0)
    #expect(t.stageName == "Intake")
    #expect(t.round == 1)
    #expect(t.skipped.isEmpty)
    #expect(t.route == nil)
    #expect(t.routeProposal == nil)
    #expect(TicketRoute.mode(t) == .reading)
    #expect(TicketRoute.summary(t) == nil)
    #expect(TicketRoute.header(t) == ["#1", "Intake"])
    #expect(try decode(Ticket.self, #"{"thread_id":"t4","stage":4}"#).stageName == "Test")
  }

  @Test func marksEachStageDoneCurrentAheadOrOff() throws {
    let t = try decode(Ticket.self, routedJSON)
    #expect(TicketRoute.state(of: 1, in: t) == .done)
    #expect(TicketRoute.state(of: 3, in: t) == .current)
    #expect(TicketRoute.state(of: 4, in: t) == .ahead)
    #expect(TicketRoute.state(of: 6, in: t) == .off)
    #expect(TicketRoute.state(of: 10, in: t) == .ahead)
    let closed = try decode(Ticket.self, #"{"thread_id":"t","stage":10,"route":[1,10],"closed_at":"2026-10-28T09:00:00.000Z"}"#)
    #expect(TicketRoute.state(of: 10, in: closed) == .done)
    #expect(TicketRoute.state(of: 5, in: closed) == .off)
    let skipped = try decode(Ticket.self, #"{"thread_id":"t","stage":2,"route":[1,2,3],"skipped":[3]}"#)
    #expect(TicketRoute.state(of: 3, in: skipped) == .off)
  }

  @Test func summarisesTheRoute() throws {
    #expect(TicketRoute.summary(try decode(Ticket.self, routedJSON)) == "9 of 10 stages")
    #expect(TicketRoute.summary(try decode(Ticket.self, proposedJSON)) == "5 of 10 stages")
    #expect(TicketRoute.header(try decode(Ticket.self, routedJSON)) == ["#1060", "Round 2", "Execute", "9 of 10 stages"])
    #expect(TicketRoute.header(try decode(Ticket.self, proposedJSON)) == ["L-001", "Intake", "5 of 10 stages"])
  }

  @Test func togglesStagesInADraft() {
    var draft = TicketRouteDraft([3, 1, 11, 0])
    #expect(draft.sorted == [1, 3])
    draft.toggle(2)
    draft.toggle(3)
    draft.toggle(12)
    #expect(draft.sorted == [1, 2])
    #expect(draft.contains(2))
    #expect(draft.canSave)
    draft.toggle(1)
    draft.toggle(2)
    #expect(!draft.canSave)
  }

  @Test func returnsNilForAThreadThatIsNotATicket() async throws {
    let t = StubTransport(status: 404, body: #"{"error":"not a ticket"}"#)
    let ticket = try await OmniClient(port: 4799, transport: t).ticket(threadID: "a b")
    #expect(ticket == nil)
    #expect(t.requests[0].httpMethod == "GET")
    #expect(t.requests[0].url?.absoluteString == "http://127.0.0.1:4799/api/tickets/a%20b")
  }

  @Test func throwsOtherFailuresWhenItReadsATicket() async {
    let t = StubTransport(status: 500, body: #"{"error":"boom"}"#)
    await #expect(throws: OmniAPIError.http(status: 500, message: "boom")) {
      _ = try await OmniClient(port: 4799, transport: t).ticket(threadID: "t1")
    }
  }

  @Test func savesTheRoute() async throws {
    let t = StubTransport(body: routedJSON)
    let ticket = try await OmniClient(port: 4799, transport: t).setTicketRoute(threadID: "t1", stages: [1, 3, 4])
    #expect(ticket.ref == "#1060")
    #expect(t.requests[0].httpMethod == "POST")
    #expect(t.requests[0].url?.path == "/api/tickets/t1/route")
    #expect(try bodyJSON(t.requests[0]) == .object(["stages": .array([.number(1), .number(3), .number(4)])]))
  }
  @Test func showsCloseOnlyAtTheLastStageOfAnOpenRoute() throws {
    #expect(TicketRoute.canClose(try decode(Ticket.self, #"{"thread_id":"t","stage":9,"route":[1,3,9]}"#)))
    #expect(!TicketRoute.canClose(try decode(Ticket.self, #"{"thread_id":"t","stage":3,"route":[1,3,9]}"#)))
    #expect(!TicketRoute.canClose(try decode(Ticket.self, #"{"thread_id":"t","stage":10}"#)))
    #expect(!TicketRoute.canClose(try decode(Ticket.self, #"{"thread_id":"t","stage":0,"route_proposal":{"stages":[1]}}"#)))
    let closed = try decode(Ticket.self, ##"{"thread_id":"t","ref":"#9","stage":9,"stage_name":"Deploy","route":[1,9],"closed_at":"2026-10-29T09:00:00.000Z"}"##)
    #expect(!TicketRoute.canClose(closed))
    #expect(TicketRoute.header(closed) == ["#9", "Closed", "2 of 10 stages"])
  }

  @Test func labelsTheDraft() throws {
    let label = { (kind: String) in try decode(Ticket.Draft.self, #"{"kind":"\#(kind)","text":"x"}"#).label }
    #expect(try label("qa") == "QA note")
    #expect(try label("answer") == "Client answer")
    #expect(try label("closing") == "Closing comment")
    #expect(try label("other") == "Draft")
  }

  @Test func closesTheTicket() async throws {
    let t = StubTransport(body: routedJSON)
    _ = try await OmniClient(port: 4799, transport: t).closeTicket(threadID: "t1")
    #expect(t.requests[0].httpMethod == "POST")
    #expect(t.requests[0].url?.path == "/api/tickets/t1/close")
    #expect(try bodyJSON(t.requests[0]) == .object(["by": .string("user")]))
  }
  @Test func mapsEachStageToItsPhase() {
    let phases = (0...10).map { TicketPhase.of(stage: $0) }
    #expect(phases == [.neutral, .discover, .discover, .build, .build, .build, .manualTest, .client, .client, .deploy, .closing])
    #expect(TicketPhase.of(stage: 9, closed: true) == .neutral)
    #expect(TicketPhase.of(stage: 11) == .neutral)
  }

  @Test func labelsTheStagePill() throws {
    #expect(try decode(Ticket.self, routedJSON).stageLabel == "3 · Execute")
    #expect(try decode(Ticket.self, proposedJSON).stageLabel == "Intake")
    #expect(try decode(Ticket.self, #"{"thread_id":"t","stage":10,"closed_at":"2026-10-29T09:00:00.000Z"}"#).stageLabel == "Closed")
    #expect(try decode(Ticket.self, routedJSON).phase == .build)
  }

  @Test func groupsTicketsByStageInStageOrder() throws {
    let list = try decode([Ticket].self, """
      [{"thread_id":"a","stage":3,"updated_at":"2026-10-28T09:00:00.000Z"},
       {"thread_id":"b","stage":0,"updated_at":"2026-10-28T09:00:00.000Z"},
       {"thread_id":"c","stage":3,"updated_at":"2026-10-29T09:00:00.000Z"},
       {"thread_id":"d","stage":10,"updated_at":"2026-10-28T09:00:00.000Z"},
       {"thread_id":"e","stage":5,"closed_at":"2026-10-28T09:00:00.000Z"}]
      """)
    let sections = TicketBoard.sections(list)
    #expect(sections.map(\.title) == ["Intake", "3 Execute", "10 Closing"])
    #expect(sections[1].tickets.map(\.threadID) == ["c", "a"])
    #expect(sections.map(\.phase) == [.neutral, .build, .closing])
    #expect(TicketBoard.sections([]).isEmpty)
    let t1 = try decode(OmniThread.self, threadJSON())
    let t2 = try decode(OmniThread.self, threadJSON().replacingOccurrences(of: #""id":"t1""#, with: #""id":"t9""#))
    let tickets = try decode([Ticket].self, #"[{"thread_id":"t1"}]"#)
    #expect(TicketBoard.others([t1, t2], tickets: tickets).map(\.id) == ["t9"])
  }

  @Test func listsAChannelsTickets() async throws {
    let t = StubTransport(body: "[\(routedJSON)]")
    let list = try await OmniClient(port: 4799, transport: t).tickets(channel: "acme")
    #expect(list.map(\.threadID) == ["t1"])
    #expect(t.requests[0].httpMethod == "GET")
    #expect(t.requests[0].url?.path == "/api/tickets")
    #expect(t.requests[0].url?.query == "channel=acme")
  }
}
