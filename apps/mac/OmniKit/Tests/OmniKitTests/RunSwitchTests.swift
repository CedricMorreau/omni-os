import Foundation
import Testing
@testable import OmniKit

// The strings come from packages/shared/run-switch.ts, which the Web UI renders.

private let opus = RunName(harness: "claude-code", model: "opus", effort: "", harnessName: "Claude Code", modelLabel: "Opus 4.7")
private let opusHigh = RunName(harness: "claude-code", model: "opus", effort: "high", harnessName: "Claude Code", modelLabel: "Opus 4.7")
private let sonnet = RunName(harness: "claude-code", model: "sonnet", effort: "low", harnessName: "Claude Code", modelLabel: "Sonnet 4.6")
private let codex = RunName(harness: "codex", model: "gpt-5.5", effort: "", harnessName: "Codex", modelLabel: "GPT-5.5")

private let harnessesJSON = """
[
 {"id":"claude-code","name":"Claude Code","plan":"Claude plan","capabilities":{"warmProcess":true,"steer":true,"inlineImages":true,"usage":"five-hour-week"},
  "available":true,"cap":4,"running":0,"models":[
   {"id":"opus","label":"Opus","efforts":["low","high"],"defaultEffort":"high"},
   {"id":"sonnet","label":"Sonnet","default":true,"efforts":["low","medium","high"],"defaultEffort":"medium"}]},
 {"id":"codex","name":"Codex","plan":"ChatGPT plan","capabilities":{"warmProcess":false,"steer":false,"inlineImages":false,"usage":"none"},
  "available":true,"cap":4,"running":0,"models":[{"id":"gpt-x","label":"GPT X","default":true,"efforts":["high"]}]}
]
"""

private func harnesses() -> [HarnessInfo] {
  try! OmniJSON.decoder().decode([HarnessInfo].self, from: Data(harnessesJSON.utf8))
}

private func thread(model: String?, effort: String) throws -> OmniThread {
  let json = threadJSON(effort: effort).replacingOccurrences(of: #""model":"sonnet""#, with: model.map { #""model":"\#($0)""# } ?? #""model":null"#)
  return try OmniJSON.decoder().decode(OmniThread.self, from: Data(json.utf8))
}

private func event(_ id: Int, _ kind: String, _ payload: some Encodable) throws -> String {
  eventJSON(kind: kind, payload: String(decoding: try JSONEncoder().encode(payload), as: UTF8.self), id: id)
}

private func events(_ json: [String]) throws -> [EventRow] {
  try OmniJSON.decoder().decode([EventRow].self, from: Data("[\(json.joined(separator: ","))]".utf8))
}

@Suite struct RunSwitchTests {
  @Test func switchTextReadsAsTheWebUI() {
    #expect(RunSwitch.switchText(SwitchP(from: opus, to: opusHigh, mode: .settings)) == "Switched to effort high")
    #expect(RunSwitch.switchText(SwitchP(from: opusHigh, to: opus, mode: .settings)) == "Switched to default effort")
    #expect(RunSwitch.switchText(SwitchP(from: opus, to: sonnet, mode: .settings)) == "Switched to Sonnet 4.6, effort low")
    #expect(RunSwitch.switchText(SwitchP(from: opus, to: codex, mode: .settings)) == "Switched to Codex (GPT-5.5), default effort")
    #expect(RunSwitch.switchText(SwitchP(from: opus, to: codex, mode: .handover)) == "Handing over from Claude Code (Opus 4.7) to Codex (GPT-5.5)")
    #expect(RunSwitch.switchText(SwitchP(from: codex, to: opus, mode: .back)) == "Switched back to Claude Code (Opus 4.7), which continues its own session")
  }

  @Test func handoverNoteReadsAsTheWebUI() {
    let handover = SwitchP(from: opus, to: codex, mode: .handover)
    #expect(RunSwitch.handoverNote(SwitchP(from: opus, to: sonnet, mode: .settings), done: nil, superseded: false) == nil)
    #expect(RunSwitch.handoverNote(SwitchP(from: codex, to: opus, mode: .back), done: nil, superseded: true) == nil)
    #expect(RunSwitch.handoverNote(handover, done: nil, superseded: false) == "Codex reads the thread so far with your next message.")
    #expect(RunSwitch.handoverNote(handover, done: nil, superseded: true) == "Replaced by a later switch.")
    let one = HandoverP(to: codex, session: .fresh, entries: 1, omitted: 0, chars: 90)
    #expect(RunSwitch.handoverNote(handover, done: one, superseded: false) == "Handover complete. Codex read 1 entry into a new session.")
    let cut = HandoverP(to: codex, session: .resumed, entries: 12, omitted: 3, chars: 30_000)
    #expect(RunSwitch.handoverNote(handover, done: cut, superseded: true) == "Handover complete. Codex read 12 entries into its earlier session, 3 older left out.")
  }

  @Test func decodesTheEvents() throws {
    let rows = try events([
      try event(1, "switch", SwitchP(from: opus, to: codex, mode: .handover)),
      try event(2, "handover", HandoverP(to: codex, session: .fresh, entries: 4, omitted: 0, chars: 800)),
      eventJSON(kind: "switch", payload: #"{"mode":"sideways"}"#, id: 3),
    ])
    #expect(rows[0].content == .runSwitch(SwitchP(from: opus, to: codex, mode: .handover)))
    #expect(rows[1].content == .handover(HandoverP(to: codex, session: .fresh, entries: 4, omitted: 0, chars: 800)))
    guard case .unknown(kind: "switch", _) = rows[2].content else { Issue.record("kept as unknown: \(rows[2].content)"); return }
  }

  /// Events that arrive one at a time fold as the whole list does: a later handover supersedes a pending one, and
  /// the handover event completes the one still pending.
  @Test func foldsSwitchesAsEventsArrive() throws {
    let rows = try events([
      try event(1, "switch", SwitchP(from: opus, to: codex, mode: .handover)),
      try event(2, "switch", SwitchP(from: codex, to: opus, mode: .back)),
      try event(3, "switch", SwitchP(from: opus, to: codex, mode: .handover)),
      try event(4, "switch", SwitchP(from: codex, to: codex, mode: .settings)),
      try event(5, "handover", HandoverP(to: codex, session: .resumed, entries: 2, omitted: 0, chars: 300)),
      try event(6, "handover", HandoverP(to: codex, session: .resumed, entries: 9, omitted: 0, chars: 300)),
    ])
    var live = Transcript()
    for n in 1...rows.count { live.update(Array(rows.prefix(n))) }
    #expect(live.items == Transcript.build(rows))
    let switches = live.items.compactMap { if case .runSwitch(let r) = $0 { r } else { nil } }
    #expect(switches.map(\.eventID) == [1, 2, 3, 4])
    #expect(switches.map(\.superseded) == [true, false, false, false])
    #expect(switches[2].done?.entries == 2)
    #expect(switches.map(\.isPending) == [false, false, false, false])
    #expect(switches[2].note == "Handover complete. Codex read 2 entries into its earlier session.")
  }

  @Test func pickersShowTheThreadsRun() throws {
    let picked = RunSwitch.current(try thread(model: "opus", effort: "high"))
    #expect(picked == Run(harness: .claudeCode, model: "opus", effort: "high"))
    #expect(RunSwitch.shownModel(picked, harnesses: harnesses()) == "opus")
    // No model is the harness default, which the list marks. The request keeps it empty.
    let byDefault = RunSwitch.current(try thread(model: nil, effort: ""))
    #expect(byDefault == Run(harness: .claudeCode, model: "", effort: ""))
    #expect(RunSwitch.shownModel(byDefault, harnesses: harnesses()) == "sonnet")
    #expect(RunSwitch.shownModel(byDefault, harnesses: []) == "")
  }

  @Test func pickingAModelResetsEffortAndTheSameRunIsNoChange() {
    let current = Run(harness: .claudeCode, model: "opus", effort: "high")
    #expect(RunSwitch.picking(harness: .claudeCode, model: "opus", from: current, harnesses: harnesses()) == nil)
    #expect(RunSwitch.picking(harness: .claudeCode, model: "sonnet", from: current, harnesses: harnesses()) == Run(harness: .claudeCode, model: "sonnet", effort: ""))
    #expect(RunSwitch.picking(harness: .codex, model: "gpt-x", from: current, harnesses: harnesses()) == Run(harness: .codex, model: "gpt-x", effort: ""))
    #expect(RunSwitch.picking(effort: "high", from: current) == nil)
    #expect(RunSwitch.picking(effort: "", from: current) == Run(harness: .claudeCode, model: "opus", effort: ""))
    let byDefault = Run(harness: .claudeCode, model: "", effort: "low")
    #expect(RunSwitch.picking(harness: .claudeCode, model: "sonnet", from: byDefault, harnesses: harnesses()) == nil)
    #expect(RunSwitch.picking(effort: "high", from: byDefault) == Run(harness: .claudeCode, model: "", effort: "high"))
  }

  @Test func pickersShowAndPickFromTheQueuedRun() throws {
    let plain = try thread(model: "opus", effort: "high")
    #expect(RunSwitch.queued(plain) == nil)
    #expect(RunSwitch.shown(plain) == RunSwitch.current(plain))
    let json = threadJSON(effort: "high").replacingOccurrences(
      of: #""model":"sonnet""#, with: #""model":"opus","queued_harness":"codex","queued_model":"","queued_effort":"""#)
    let queued = try OmniJSON.decoder().decode(OmniThread.self, from: Data(json.utf8))
    #expect(RunSwitch.queued(queued) == Run(harness: .codex, model: "", effort: ""))
    #expect(RunSwitch.shown(queued) == Run(harness: .codex, model: "", effort: ""))
    #expect(RunSwitch.current(queued) == Run(harness: .claudeCode, model: "opus", effort: "high"))
    // A pick starts from the queued run, so the queued run again changes nothing.
    #expect(RunSwitch.picking(effort: "", from: RunSwitch.shown(queued)) == nil)
    #expect(RunSwitch.describe(RunSwitch.current(queued), harnesses: harnesses()) == "Opus, high")
  }

  @Test func postsTheRun() async throws {
    let t = StubTransport(body: threadJSON())
    let switched = try await OmniClient(port: 4799, transport: t).switchRun("t 1", to: Run(harness: .codex, model: "gpt-x", effort: ""))
    #expect(switched.id == "t1")
    let req = try #require(t.requests.first)
    #expect(req.httpMethod == "POST")
    #expect(req.url?.absoluteString == "http://127.0.0.1:4799/api/threads/t%201/run")
    #expect(try bodyJSON(req) == .object(["harness": .string("codex"), "model": .string("gpt-x"), "effort": .string("")]))
  }

  @Test func aRefusalCarriesTheServersReason() async throws {
    let t = StubTransport(status: 409, body: #"{"error":"Wait for this turn to end, then switch."}"#)
    await #expect(throws: OmniAPIError.http(status: 409, message: "Wait for this turn to end, then switch.")) {
      try await OmniClient(port: 4799, transport: t).switchRun("t1", to: Run(harness: .codex, model: "", effort: ""))
    }
  }
}
