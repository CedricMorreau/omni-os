import Foundation
import Observation

/// The state of this machine's Cloudflare tunnel (apps/server/connect/tunnel.ts). Missing means cloudflared is not
/// installed; the status's error then says how to install it.
public struct TunnelState: OpenEnum {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let off: Self = "off"
  public static let starting: Self = "starting"
  public static let connected: Self = "connected"
  public static let restarting: Self = "restarting"
  public static let missing: Self = "missing"

  public var label: String {
    switch self {
    case .off: "Off"
    case .starting: "Starting"
    case .connected: "Connected"
    case .restarting: "Restarting"
    case .missing: "cloudflared missing"
    default: rawValue.capitalized
    }
  }
}

/// GET /api/connect, and the answer of enable and disable: Omni Connect on this machine
/// (apps/server/connect/service.ts, docs/adr/0009-omni-connect.md).
public struct ConnectStatus: Decodable, Hashable, Sendable {
  public struct Tunnel: Decodable, Hashable, Sendable {
    public let state: TunnelState
    /// The last error cloudflared logged, or why it could not start.
    public let error: String?
    /// The cloudflared binary it runs, nil until found.
    public let cloudflared: String?
  }

  public let enabled: Bool
  /// Signed in to a relay that has Connect set up. Nil until the server has asked the relay.
  public let relayReady: Bool?
  /// Signed in to the sync relay, which Connect uses.
  public let signedIn: Bool
  public let hostname: String?
  /// This Mac's public URL while Connect is on.
  public let url: String?
  /// The relay's Connect page, where any device signs in and opens a machine.
  public let connectPage: String?
  public let tunnel: Tunnel
  /// Why the last registration with the relay failed, while Connect is on.
  public let error: String?

  public var publicURL: URL? { url.flatMap(URL.init(string:)) }
  public var connectPageURL: URL? { connectPage.flatMap(URL.init(string:)) }
}

/// One machine on Omni Connect, as the relay sees it: GET /api/connect/machines.
public struct ConnectMachine: Decodable, Hashable, Sendable, Identifiable {
  public let id: String
  public let name: String
  public let hostname: String
  public let url: String
  /// It answered the relay just now.
  public let online: Bool
  public let problem: String?
  /// This Mac.
  public let current: Bool

  /// The machine's Connect page, where a browser trades the relay's one-time code for a session.
  public var openURL: URL? { URL(string: (url.hasSuffix("/") ? String(url.dropLast()) : url) + "/#/connect") }
}

/// GET /api/connect/machines.
public struct ConnectMachines: Decodable, Hashable, Sendable {
  public let machines: [ConnectMachine]
}

private struct EmptyBody: Encodable, Sendable {}

extension OmniClient {
  public func connectStatus() async throws(OmniAPIError) -> ConnectStatus {
    try await send("GET", "/api/connect")
  }

  /// Registers this Mac with the relay and starts the tunnel. Refusals (not signed in, no Connect on the relay,
  /// another Google account) answer 4xx or 5xx with the reason.
  public func enableConnect() async throws(OmniAPIError) -> ConnectStatus {
    try await send("POST", "/api/connect/enable", body: EmptyBody())
  }

  /// Stops the tunnel and has the relay delete it.
  public func disableConnect() async throws(OmniAPIError) -> ConnectStatus {
    try await send("POST", "/api/connect/disable", body: EmptyBody())
  }

  /// Every machine on Connect. 409 before the sync sign-in, 503 when the relay has no Connect.
  public func connectMachines() async throws(OmniAPIError) -> [ConnectMachine] {
    let reply: ConnectMachines = try await send("GET", "/api/connect/machines")
    return reply.machines
  }
}

/// The Omni Connect card of the Sharing & access section: the switch, this Mac's public URL and tunnel, the relay's Connect page,
/// and the machines on Connect, each opened in the browser. The app stays a client of its own server (ADR 0002).
@MainActor @Observable
public final class ConnectModel {
  public private(set) var status: ConnectStatus?
  public private(set) var loadError: String?
  public private(set) var machines: [ConnectMachine] = []
  /// Why the machines could not be listed, like a relay with no Connect.
  public private(set) var machinesError: String?
  public private(set) var isBusy = false
  /// What the last enable or disable failed with.
  public private(set) var actionError: String?

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private var loads = 0

  public init(client: OmniClient) {
    self.client = client
  }

  /// Loads the status and the machines.
  public func load() async {
    await refresh()
    await loadMachines()
  }

  /// Loads the status again. When loads overlap, the latest one's answer wins. A changed tunnel state lists the
  /// machines again: the relay sees this Mac as offline until its tunnel is up.
  public func refresh() async {
    loads += 1
    let load = loads
    do throws(OmniAPIError) {
      let s = try await client.connectStatus()
      guard load == loads else { return }
      let before = status?.tunnel.state
      status = s
      loadError = nil
      if let before, before != s.tunnel.state { await loadMachines() }
    } catch {
      guard load == loads, error != .cancelled else { return }
      if status == nil { loadError = error.message }
    }
  }

  /// The machines, while signed in to the relay. Signed out there is nothing to list.
  public func loadMachines() async {
    guard status?.signedIn == true else {
      machines = []
      machinesError = nil
      return
    }
    do throws(OmniAPIError) {
      machines = try await client.connectMachines()
      machinesError = nil
    } catch {
      guard error != .cancelled else { return }
      machines = []
      machinesError = error.message
    }
  }

  /// Turns Connect on or off for this Mac, then lists the machines again.
  public func setEnabled(_ on: Bool) async {
    guard !isBusy else { return }
    isBusy = true
    actionError = nil
    defer { isBusy = false }
    do throws(OmniAPIError) {
      loads += 1
      status = try await on ? client.enableConnect() : client.disableConnect()
    } catch {
      if error != .cancelled { actionError = error.message }
      await refresh()
    }
    await loadMachines()
  }
}
