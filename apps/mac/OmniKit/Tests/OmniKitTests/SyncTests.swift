import Foundation
import Synchronization
import Testing
import OmniKit

private func statusJSON(_ patch: [String: String] = [:]) throws -> String {
  var json = try fixture("sync-status.json")
  for (key, value) in patch {
    json = json.replacingOccurrences(
      of: #""\#(key)": [^,\n]+"#, with: #""\#(key)": \#(value)"#, options: .regularExpression)
  }
  return json
}

/// The /api/sync routes as the server answers them. A failure set for a path answers every write to it.
private final class SyncServer: Sendable {
  private struct State {
    var status: String
    var map = #"{"map":{}}"#
    var setup = #"{"flow":"f1","secret":"s1","userCode":"ABCD-EFGH","verificationUri":"https://clerk.example/device","verificationUriComplete":"https://clerk.example/device?code=ABCD-EFGH","expiresAt":"2026-11-01T12:10:00.000Z","interval":1}"#
    var poll = #"{"state":"pending"}"#
    var failures: [String: (status: Int, body: String)] = [:]
  }

  private final class Box: Sendable {
    let state: Mutex<State>
    init(_ state: State) { self.state = Mutex(state) }
  }

  private let box: Box
  let transport: StubTransport

  init() throws {
    let box = Box(State(status: try statusJSON()))
    self.box = box
    transport = StubTransport { req in
      let path = req.url!.path
      let s = box.state.withLock { $0 }
      if req.httpMethod != "GET", let f = s.failures[path] { return StubTransport.Reply(status: f.status, body: f.body) }
      switch (req.httpMethod ?? "GET", path) {
      case ("GET", "/api/sync/status"): return StubTransport.Reply(body: s.status)
      case (_, "/api/sync/path-map"): return StubTransport.Reply(body: s.map)
      case ("POST", "/api/sync/setup"): return StubTransport.Reply(body: s.setup)
      case ("POST", "/api/sync/setup/poll"): return StubTransport.Reply(body: s.poll)
      default: return StubTransport.Reply(body: #"{"ok":true,"status":\#(s.status)}"#)
      }
    }
  }

  func status(_ json: String) { box.state.withLock { $0.status = json } }
  func map(_ json: String) { box.state.withLock { $0.map = json } }
  func setup(_ json: String) { box.state.withLock { $0.setup = json } }
  func poll(_ json: String) { box.state.withLock { $0.poll = json } }
  func fail(_ path: String, _ status: Int, _ body: String) { box.state.withLock { $0.failures[path] = (status, body) } }

  var client: OmniClient { OmniClient(port: 4799, transport: transport) }
  var writes: [URLRequest] { transport.requests.filter { $0.httpMethod != "GET" } }
}

@Suite struct SyncStatusTests {
  @Test func decodesTheStatus() throws {
    let s = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON().utf8))
    #expect(s.configured && s.enabled && !s.running && !s.signedOut)
    #expect(s.machineId == "3f9c2a1e7b4d")
    #expect(s.automations?.owner == "3f9c2a1e7b4d")
    #expect(s.automations?.isThisMac == true)
    #expect(s.lastSyncAt == OmniJSON.parseDate("2026-09-28T09:15:02.123Z"))
    #expect(s.lastError == nil)
    #expect((s.pending, s.held, s.deferred, s.cursor) == (2, 0, 1, 418))
    #expect(s.phase == .waiting)
    #expect(s.phaseLabel == "Waiting to push")
    #expect(!s.needsSignIn)
    #expect(s.legacyRelay == false)
  }

  @Test func phaseFollowsTheWebPage() throws {
    func phase(_ patch: [String: String]) throws -> SyncStatus.Phase {
      try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(patch).utf8)).phase
    }
    #expect(try phase(["enabled": "false", "running": "true"]) == .paused)
    #expect(try phase(["running": "true", "lastError": #""relay down""#]) == .syncing)
    #expect(try phase(["lastError": #""relay down""#]) == .failing)
    #expect(try phase(["lastSyncAt": "null"]) == .starting)
    #expect(try phase(["pending": "0"]) == .upToDate)
  }

  @Test func signInShowsWhenOffOrSignedOut() throws {
    let off = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(["configured": "false"]).utf8))
    let out = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(["signedOut": "true"]).utf8))
    #expect(off.needsSignIn && out.needsSignIn)
    let legacy = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(try statusJSON(["configured": "false", "legacyRelay": "true"]).utf8))
    #expect(legacy.needsSignIn && legacy.legacyRelay == true)
  }

  @Test func anOlderServerWithoutLegacyRelayDecodes() throws {
    let json = try statusJSON().replacingOccurrences(of: #""legacyRelay": false,"#, with: "")
    let s = try OmniJSON.decoder().decode(SyncStatus.self, from: Data(json.utf8))
    #expect(s.legacyRelay == nil)
  }
}

@Suite struct SyncClientTests {
  @Test func actionsPostAndReturnTheStatus() async throws {
    let server = try SyncServer()
    let c = server.client
    _ = try await c.syncNow()
    _ = try await c.disableSync()
    _ = try await c.disableSync(forget: true)
    _ = try await c.enableSync()
    let w = server.writes
    #expect(w.map { "\($0.httpMethod!) \($0.url!.path)" } == [
      "POST /api/sync/now", "POST /api/sync/disable", "POST /api/sync/disable", "POST /api/sync/enable",
    ])
    #expect(try bodyJSON(w[0]) == .object([:]))
    #expect(try bodyJSON(w[1]) == .object(["forget": .bool(false)]))
    #expect(try bodyJSON(w[2]) == .object(["forget": .bool(true)]))
  }

  @Test func choosesTheAutomationsMachine() async throws {
    let server = try SyncServer()
    _ = try await server.client.setAutomationsMachine("mac-b")
    _ = try await server.client.setAutomationsMachine("")
    let writes = server.writes
    #expect(writes.map { $0.url!.path } == ["/api/sync/automations-owner", "/api/sync/automations-owner"])
    #expect(try bodyJSON(writes[0]) == .object(["device": .string("mac-b")]))
    #expect(try bodyJSON(writes[1]) == .object(["device": .string("here")]))
  }

  @Test func setupSendsTheURLAndPollsWithTheFlow() async throws {
    let server = try SyncServer()
    let start = try await server.client.setupSync(SyncSetup(url: "https://omni-relay.ben.workers.dev"))
    #expect(start.userCode == "ABCD-EFGH")
    #expect(start.pageURL == URL(string: "https://clerk.example/device?code=ABCD-EFGH"))
    let signedIn = try statusJSON()
    server.poll(#"{"state":"signed_in","email":"ben@example.com","relayChanged":true,"status":\#(signedIn)}"#)
    let r = try await server.client.pollSyncSetup(start)
    #expect(r.state == "signed_in" && r.email == "ben@example.com" && r.relayChanged == true)
    #expect(r.status?.cursor == 418)
    let w = server.writes
    #expect(w.map(\.url!.path) == ["/api/sync/setup", "/api/sync/setup/poll"])
    #expect(try bodyJSON(w[0]) == .object(["url": .string("https://omni-relay.ben.workers.dev")]))
    #expect(try bodyJSON(w[1]) == .object(["flow": .string("f1"), "secret": .string("s1")]))
  }

  @Test func pathMapRoundTrips() async throws {
    let server = try SyncServer()
    server.map(#"{"map":{"/Users/ben/Code":"~/Projects"}}"#)
    #expect(try await server.client.syncPathMap() == ["/Users/ben/Code": "~/Projects"])
    _ = try await server.client.setSyncPathMap(["/a": "/b"])
    let put = try #require(server.writes.first)
    #expect(put.httpMethod == "PUT")
    #expect(try bodyJSON(put) == .object(["map": .object(["/a": .string("/b")])]))
  }

  @Test func aFailingRelayCarriesTheServerMessage() async throws {
    let server = try SyncServer()
    server.fail("/api/sync/now", 502, #"{"error":"relay down","status":{}}"#)
    await #expect(throws: OmniAPIError.http(status: 502, message: "relay down")) { try await server.client.syncNow() }
  }
}

@MainActor @Suite struct SyncModelTests {
  private func loaded(_ server: SyncServer) async -> SyncModel {
    let m = SyncModel(client: server.client)
    await m.load()
    return m
  }

  private func fill(_ m: SyncModel) {
    m.url = " https://omni-relay.ben.workers.dev "
  }

  @Test func loadsStatusAndPathMapSorted() async throws {
    let server = try SyncServer()
    server.map(#"{"map":{"/b":"~/b","/a":"~/a"}}"#)
    let m = await loaded(server)
    #expect(m.loadState == .loaded)
    #expect(m.status?.cursor == 418)
    #expect(m.mappings.map(\.from) == ["/a", "/b"])
    #expect(m.mappingsLoaded && !m.mappingsSaved)
  }

  @Test func anUnreachableServerFailsTheLoad() async {
    let m = SyncModel(client: OmniClient(port: 4799, transport: StubTransport { _ in throw URLError(.cannotConnectToHost) }))
    await m.load()
    #expect(m.loadState == .failed(OmniAPIError.unreachable("").message))
  }

  @Test func signInWaitsForClerkThenShowsTheStatus() async throws {
    let server = try SyncServer()
    server.status(try statusJSON(["configured": "false"]))
    let m = await loaded(server)
    #expect(!m.canSignIn)
    fill(m)
    #expect(m.canSignIn)
    let start = await m.startSignIn()
    #expect(start?.userCode == "ABCD-EFGH")
    #expect(m.signingIn == start && !m.canSignIn)
    let first = try bodyJSON(try #require(server.writes.first))
    #expect(first == .object(["url": .string("https://omni-relay.ben.workers.dev")]))

    let signedIn = try statusJSON()
    server.poll(#"{"state":"signed_in","email":"ben@example.com","relayChanged":true,"status":\#(signedIn)}"#)
    try await waitFor("the sign-in", within: .seconds(5)) { m.signingIn == nil }
    #expect(m.status?.configured == true)
    #expect(m.relayChanged)
    #expect(m.signInError == nil)
  }

  @Test func aRefusedRelayShowsWhy() async throws {
    let server = try SyncServer()
    server.fail("/api/sync/setup", 400, #"{"error":"That is not an Omni relay"}"#)
    let m = await loaded(server)
    fill(m)
    #expect(await m.startSignIn() == nil)
    #expect(m.signInError == "That is not an Omni relay")
    #expect(m.signingIn == nil && !m.isStarting)
    #expect(m.url == " https://omni-relay.ben.workers.dev ", "the URL stays to fix")
  }

  @Test func aSignInRefusedOnTheRelayEndsWithItsReason() async throws {
    let server = try SyncServer()
    server.poll(#"{"state":"refused","error":"ben@example.com may not use this relay"}"#)
    let m = await loaded(server)
    fill(m)
    _ = await m.startSignIn()
    try await waitFor("the refusal", within: .seconds(5)) { m.signingIn == nil }
    #expect(m.signInError == "ben@example.com may not use this relay")
  }

  @Test func aDeclinedOrExpiredCodeSaysSo() async throws {
    let server = try SyncServer()
    server.poll(#"{"state":"denied"}"#)
    let m = await loaded(server)
    fill(m)
    _ = await m.startSignIn()
    try await waitFor("the denial", within: .seconds(5)) { m.signingIn == nil }
    #expect(m.signInError == "Sign-in was declined on the Clerk page.")
    server.poll(#"{"state":"expired"}"#)
    _ = await m.startSignIn()
    #expect(m.signInError == nil)
    try await waitFor("the expiry", within: .seconds(5)) { m.signingIn == nil }
    #expect(m.signInError == "The code expired before it was approved. Start again.")
  }

  @Test func cancelStopsPolling() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    fill(m)
    _ = await m.startSignIn()
    m.cancelSignIn()
    #expect(m.signingIn == nil && m.canSignIn)
    try await Task.sleep(for: .milliseconds(1_200))
    #expect(!server.writes.contains { $0.url!.path == "/api/sync/setup/poll" })
  }

  @Test func pauseResumeAndSignOut() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    server.status(try statusJSON(["enabled": "false"]))
    await m.togglePause()
    #expect(m.status?.phase == .paused)
    server.status(try statusJSON())
    await m.togglePause()
    await m.signOut()
    let w = server.writes
    #expect(w.map(\.url!.path) == ["/api/sync/disable", "/api/sync/enable", "/api/sync/disable"])
    #expect(try bodyJSON(w[2]) == .object(["forget": .bool(true)]))
    #expect(m.busy == nil)
  }

  @Test func aFailedSyncNowShowsWhyAndReloads() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    server.fail("/api/sync/now", 502, #"{"error":"relay down"}"#)
    server.status(try statusJSON(["lastError": #""relay down""#]))
    await m.syncNow()
    #expect(m.actionError == "relay down")
    #expect(m.status?.phase == .failing)
  }

  @Test func savesTheRowsWithText() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    m.addMapping()
    m.mappings[0].from = " /Users/ben/Code/ "
    m.mappings[0].to = "~/Projects"
    m.addMapping()
    m.addMapping()
    m.removeMapping(m.mappings[2].id)
    server.map(#"{"map":{"/Users/ben/Code":"~/Projects"}}"#)
    await m.saveMappings()
    let put = try #require(server.writes.first)
    #expect(try bodyJSON(put) == .object(["map": .object(["/Users/ben/Code/": .string("~/Projects")])]))
    #expect(m.mappings.map(\.from) == ["/Users/ben/Code"])
    #expect(m.mappingsSaved)
    m.mappings[0].to = "~/Elsewhere"
    #expect(!m.mappingsSaved)
  }

  @Test func aRefusedMapKeepsTheRows() async throws {
    let server = try SyncServer()
    let m = await loaded(server)
    m.addMapping()
    m.mappings[0].from = "relative"
    m.mappings[0].to = "~/x"
    server.fail("/api/sync/path-map", 400, #"{"error":"Paths start with / or ~"}"#)
    await m.saveMappings()
    #expect(m.mappingsError == "Paths start with / or ~")
    #expect(m.mappings.count == 1)
  }
}
