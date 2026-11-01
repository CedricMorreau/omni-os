import Foundation
import Synchronization
import Testing
import OmniKit

/// The /api/connect routes as the server answers them. A failure set for a path answers that path.
private final class ConnectServer: Sendable {
  private struct State {
    var status: String
    var machines: String
    var failures: [String: (status: Int, body: String)] = [:]
  }

  private final class Box: Sendable {
    let state: Mutex<State>
    init(_ state: State) { self.state = Mutex(state) }
  }

  private let box: Box
  let transport: StubTransport

  init() throws {
    let box = Box(State(status: try fixture("connect-status.json"), machines: try fixture("connect-machines.json")))
    self.box = box
    transport = StubTransport { req in
      let path = req.url!.path
      let s = box.state.withLock { $0 }
      if let f = s.failures[path] { return StubTransport.Reply(status: f.status, body: f.body) }
      switch path {
      case "/api/connect/machines": return StubTransport.Reply(body: s.machines)
      default: return StubTransport.Reply(body: s.status)
      }
    }
  }

  func status(_ json: String) { box.state.withLock { $0.status = json } }
  func fail(_ path: String, _ status: Int, _ body: String) { box.state.withLock { $0.failures[path] = (status, body) } }

  var client: OmniClient { OmniClient(port: 4799, transport: transport) }
  var calls: [String] { transport.requests.map { "\($0.httpMethod ?? "GET") \($0.url!.path)" } }
}

@Suite struct ConnectDecodingTests {
  @Test func decodesTheRecordedStatus() throws {
    let s = try decodeFixture(ConnectStatus.self, "connect-status.json")
    #expect(s.enabled && s.signedIn && s.relayReady == true)
    #expect(s.publicURL == URL(string: "https://bens-mac-a1b2c3.omni-os.app"))
    #expect(s.connectPageURL == URL(string: "https://relay.example.com/connect"))
    #expect(s.tunnel.state == .missing)
    #expect(s.tunnel.state.label == "cloudflared missing")
    #expect(s.tunnel.error?.contains("brew install cloudflared") == true)
    #expect(s.tunnel.cloudflared == nil && s.error == nil)
  }

  @Test func decodesTheRecordedMachines() throws {
    let machines = try decodeFixture(ConnectMachines.self, "connect-machines.json").machines
    #expect(machines.map(\.id) == ["mac-a", "mac-b"])
    #expect(machines[0].current && machines[0].online && machines[0].problem == nil)
    #expect(machines[0].openURL == URL(string: "https://bens-mac-a1b2c3.omni-os.app/#/connect"))
    #expect(!machines[1].current && !machines[1].online && machines[1].problem != nil)
  }

  @Test func anUnknownTunnelStateStillDecodes() throws {
    let json = try fixture("connect-status.json").replacingOccurrences(of: #""state": "missing""#, with: #""state": "draining""#)
    let s = try OmniJSON.decoder().decode(ConnectStatus.self, from: Data(json.utf8))
    #expect(s.tunnel.state.rawValue == "draining")
    #expect(s.tunnel.state.label == "Draining")
  }
}

@MainActor @Suite struct ConnectModelTests {
  @Test func loadsTheStatusAndTheMachines() async throws {
    let server = try ConnectServer()
    let m = ConnectModel(client: server.client)
    await m.load()
    #expect(m.status?.enabled == true)
    #expect(m.machines.count == 2)
    #expect(m.machinesError == nil)
    #expect(server.calls == ["GET /api/connect", "GET /api/connect/machines"])
  }

  @Test func aTunnelThatComesUpListsTheMachinesAgain() async throws {
    let server = try ConnectServer()
    let m = ConnectModel(client: server.client)
    await m.load()
    await m.refresh()
    #expect(server.calls.filter { $0 == "GET /api/connect/machines" }.count == 1)
    server.status(try fixture("connect-status.json").replacingOccurrences(of: #""state": "missing""#, with: #""state": "connected""#))
    await m.refresh()
    #expect(m.status?.tunnel.state == .connected)
    #expect(server.calls.filter { $0 == "GET /api/connect/machines" }.count == 2)
  }

  @Test func signedOutListsNoMachines() async throws {
    let server = try ConnectServer()
    server.status(try fixture("connect-status.json").replacingOccurrences(of: #""signedIn": true"#, with: #""signedIn": false"#))
    let m = ConnectModel(client: server.client)
    await m.load()
    #expect(m.status?.signedIn == false)
    #expect(m.machines.isEmpty)
    #expect(server.calls == ["GET /api/connect"])
  }

  @Test func togglingPostsAndKeepsTheAnswer() async throws {
    let server = try ConnectServer()
    let m = ConnectModel(client: server.client)
    await m.load()
    await m.setEnabled(false)
    await m.setEnabled(true)
    #expect(server.calls.filter { $0.hasPrefix("POST") } == ["POST /api/connect/disable", "POST /api/connect/enable"])
    #expect(m.actionError == nil && !m.isBusy)
  }

  @Test func aRefusedEnableShowsTheServerMessage() async throws {
    let server = try ConnectServer()
    server.fail("/api/connect/enable", 409, #"{"error":"The relay does not have Omni Connect set up yet"}"#)
    let m = ConnectModel(client: server.client)
    await m.load()
    await m.setEnabled(true)
    #expect(m.actionError == "The relay does not have Omni Connect set up yet")
    #expect(m.status != nil)
  }

  @Test func aRelayWithoutConnectShowsWhyTheListIsEmpty() async throws {
    let server = try ConnectServer()
    server.fail("/api/connect/machines", 503, #"{"error":"This relay has no Omni Connect"}"#)
    let m = ConnectModel(client: server.client)
    await m.load()
    #expect(m.machines.isEmpty)
    #expect(m.machinesError == "This relay has no Omni Connect")
  }
}
