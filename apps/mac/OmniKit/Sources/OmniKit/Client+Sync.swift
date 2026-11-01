import Foundation

/// `{}`, what the Web UI's api.post sends when there is nothing to say.
private struct EmptyBody: Encodable, Sendable {}

private struct AutomationMachineBody: Encodable, Sendable {
  let device: String
}

private struct ForgetBody: Encodable, Sendable {
  let forget: Bool
}

private struct SetupPollBody: Encodable, Sendable {
  let flow: String
  let secret: String
}

private struct PathMapBody: Codable, Sendable {
  let map: [String: String]
}

/// The answers of /now, /disable and /enable carry the status after the action.
private struct StatusReply: Decodable {
  let status: SyncStatus
}

extension OmniClient {
  public func syncStatus() async throws(OmniAPIError) -> SyncStatus {
    try await send("GET", "/api/sync/status")
  }

  /// Pushes and pulls now. A relay that fails answers 502 with its error; sync off answers 409.
  @discardableResult
  public func syncNow() async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/now", body: EmptyBody())
    return reply.status
  }

  /// Starts signing in to a relay: the server checks the URL and asks Clerk for a code to show.
  public func setupSync(_ setup: SyncSetup) async throws(OmniAPIError) -> GoogleFlowStart {
    try await send("POST", "/api/sync/setup", body: setup)
  }

  /// One poll of a relay sign-in. On signed_in the server holds this machine's relay token and sync is on.
  public func pollSyncSetup(_ start: GoogleFlowStart) async throws(OmniAPIError) -> SyncSetupPoll {
    try await send("POST", "/api/sync/setup/poll", body: SetupPollBody(flow: start.flow, secret: start.secret))
  }

  /// Pauses syncing. `forget` also removes the relay URL and this machine's token from the server's secret store.
  public func disableSync(forget: Bool = false) async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/disable", body: ForgetBody(forget: forget))
    return reply.status
  }

  public func enableSync() async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/enable", body: EmptyBody())
    return reply.status
  }

  public func setAutomationsMachine(_ device: String) async throws(OmniAPIError) -> SyncStatus {
    let reply: StatusReply = try await send("POST", "/api/sync/automations-owner", body: AutomationMachineBody(device: device.isEmpty ? "here" : device))
    return reply.status
  }

  /// This Mac's path map: a folder on the other Mac, and where it lives here.
  public func syncPathMap() async throws(OmniAPIError) -> [String: String] {
    let reply: PathMapBody = try await send("GET", "/api/sync/path-map")
    return reply.map
  }

  /// Replaces the path map. Returns it as the server kept it, trailing slashes dropped.
  public func setSyncPathMap(_ map: [String: String]) async throws(OmniAPIError) -> [String: String] {
    let reply: PathMapBody = try await send("PUT", "/api/sync/path-map", body: PathMapBody(map: map))
    return reply.map
  }
}
