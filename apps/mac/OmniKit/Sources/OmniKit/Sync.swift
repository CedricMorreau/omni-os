import Foundation
import Observation

/// GET /api/sync/status: whether history syncs with the other Mac, and what waits either way.
public struct SyncStatus: Decodable, Hashable, Sendable {
  /// The relay URL and this machine's relay token are in the server's secret store.
  public let configured: Bool
  /// Not paused.
  public let enabled: Bool
  /// A sync is in flight.
  public let running: Bool
  /// This Mac's sync id, nil until sync is set up here.
  public let machineId: String?
  /// Since the server started; nil before its first sync.
  public let lastSyncAt: Date?
  public let lastError: String?
  /// The relay refused this Mac's sign-in token: it takes a new sign-in.
  public let signedOut: Bool
  /// Failed syncs in a row.
  public let failures: Int
  public let nextSyncAt: Date?
  /// Local changes waiting to push.
  public let pending: Int
  /// Changes for an entity with no handler yet. They push once this Omni has one.
  public let held: Int
  /// This machine still holds the Supabase credentials from before sync moved to a Cloudflare relay: sign in to
  /// the new relay. Nil from an older server.
  public let legacyRelay: Bool?
  /// Remote changes that could not apply yet, retried after each pull.
  public let deferred: Int
  /// The last relay change this Mac has.
  public struct AutomationsOwner: Decodable, Hashable, Sendable {
    public let owner: String?
    public let isThisMac: Bool
  }
  public let automations: AutomationsOwner?

  public let cursor: Int

  public enum Phase: Hashable, Sendable {
    case paused, syncing, failing, starting, waiting, upToDate
  }

  /// Where sync stands, as the Web UI's Settings, Machines words it.
  public var phase: Phase {
    if !enabled { return .paused }
    if running { return .syncing }
    if lastError != nil { return .failing }
    if lastSyncAt == nil { return .starting }
    return pending > 0 ? .waiting : .upToDate
  }

  public var phaseLabel: String {
    switch phase {
    case .paused: "Paused"
    case .syncing: "Syncing"
    case .failing: "Failing"
    case .starting: "Starting"
    case .waiting: "Waiting to push"
    case .upToDate: "Up to date"
    }
  }

  /// The sign-in form shows: never signed in here, or the relay signed this Mac out.
  public var needsSignIn: Bool { !configured || signedOut }
}

/// POST /api/sync/setup: the relay to sign in to. The server answers with a Google sign-in code, like
/// /api/auth/google/link, and the app polls POST /api/sync/setup/poll until Clerk answers.
public struct SyncSetup: Encodable, Hashable, Sendable {
  public var url: String

  public init(url: String) {
    self.url = url
  }
}

/// POST /api/sync/setup/poll.
public struct SyncSetupPoll: Decodable, Hashable, Sendable {
  /// pending, signed_in, refused, denied or expired.
  public let state: String
  public let error: String?
  /// The Google account that signed in. Only with signed_in, and nil when Clerk named none.
  public let email: String?
  /// signed_in moved this machine to another relay or account: its history is queued again.
  public let relayChanged: Bool?
  /// The status after a signed_in.
  public let status: SyncStatus?
}

/// A row of the path map editor: a folder on the other Mac, and where it lives on this one.
public struct SyncPathMapping: Hashable, Sendable, Identifiable {
  public let id: UUID
  public var from: String
  public var to: String

  public init(id: UUID = UUID(), from: String = "", to: String = "") {
    self.id = id
    self.from = from
    self.to = to
  }
}

/// The Sync part of the Machines tab, like the Web UI's Settings, Machines: the status, sync now, pause, sign in and out, and the path map.
/// Sign-in is the relay URL, then Google through Clerk's device-code page, as the Google account card links one.
@MainActor @Observable
public final class SyncModel {
  public enum LoadState: Hashable, Sendable {
    case loading
    case loaded
    case failed(String)
  }

  public enum Busy: Hashable, Sendable {
    case syncing, pausing, signingOut
  }

  public private(set) var status: SyncStatus?
  public private(set) var loadState = LoadState.loading
  public private(set) var busy: Busy?
  /// What the last action failed with, like a relay that is down on Sync Now.
  public private(set) var actionError: String?

  // MARK: Sign-in
  public var url = ""
  /// A sign-in in progress: the code to compare on Clerk's page.
  public private(set) var signingIn: GoogleFlowStart?
  public private(set) var isStarting = false
  public private(set) var signInError: String?
  /// The last sign-in moved this machine to another relay or account, so its history is queued again.
  public private(set) var relayChanged = false

  // MARK: Path map
  public var mappings: [SyncPathMapping] = [] {
    didSet { mappingsSaved = false }
  }
  public private(set) var mappingsLoaded = false
  public private(set) var mappingsError: String?
  public private(set) var mappingsSaved = false
  public private(set) var isSavingMappings = false

  @ObservationIgnored private let client: OmniClient
  @ObservationIgnored private var loads = 0
  @ObservationIgnored private var pollTask: Task<Void, Never>?

  public init(client: OmniClient) {
    self.client = client
  }

  // MARK: Status

  /// Loads the status and the path map.
  public func load() async {
    await refresh()
    do throws(OmniAPIError) {
      let map = try await client.syncPathMap()
      mappings = map.sorted { $0.key < $1.key }.map { SyncPathMapping(from: $0.key, to: $0.value) }
      mappingsLoaded = true
      mappingsSaved = false
    } catch {
      guard error != .cancelled else { return }
      mappingsError = error.message
    }
  }

  /// Loads the status again. When loads overlap, the latest one's answer wins.
  public func refresh() async {
    loads += 1
    let load = loads
    do throws(OmniAPIError) {
      let s = try await client.syncStatus()
      guard load == loads else { return }
      status = s
      loadState = .loaded
    } catch {
      guard load == loads, error != .cancelled else { return }
      if status == nil { loadState = .failed(error.message) }
    }
  }

  public func syncNow() async {
    await act(.syncing) { c throws(OmniAPIError) in try await c.syncNow() }
  }

  /// Pauses a running sync, resumes a paused one. The credentials stay.
  public func togglePause() async {
    let paused = status?.enabled == false
    await act(.pausing) { c throws(OmniAPIError) in try await paused ? c.enableSync() : c.disableSync() }
  }

  /// Stops syncing and removes the relay URL and this machine's token from the secret store. History stays on this Mac.
  public func signOut() async {
    await act(.signingOut) { c throws(OmniAPIError) in try await c.disableSync(forget: true) }
  }

  private func act(_ what: Busy, _ run: (OmniClient) async throws(OmniAPIError) -> SyncStatus) async {
    guard busy == nil else { return }
    busy = what
    actionError = nil
    defer { busy = nil }
    do throws(OmniAPIError) {
      status = try await run(client)
    } catch {
      if error != .cancelled { actionError = error.message }
      await refresh()
    }
  }

  // MARK: Sign-in

  public var canSignIn: Bool { !isStarting && signingIn == nil && !trimmed(url).isEmpty }

  /// Sends the relay URL and polls until Clerk answers. Returns the code so the view can open its page.
  @discardableResult
  public func startSignIn() async -> GoogleFlowStart? {
    guard canSignIn else { return nil }
    isStarting = true
    signInError = nil
    relayChanged = false
    defer { isStarting = false }
    do throws(OmniAPIError) {
      let start = try await client.setupSync(SyncSetup(url: trimmed(url)))
      signingIn = start
      pollTask = Task { [weak self] in await self?.poll(start) }
      return start
    } catch {
      if error != .cancelled { signInError = error.message }
      return nil
    }
  }

  /// Stops waiting for Clerk, as when the tab closes. The URL stays.
  public func cancelSignIn() {
    pollTask?.cancel()
    pollTask = nil
    signingIn = nil
  }

  private func poll(_ start: GoogleFlowStart) async {
    while !Task.isCancelled {
      try? await Task.sleep(for: .seconds(max(1, start.interval)))
      guard !Task.isCancelled, signingIn == start else { return }
      do throws(OmniAPIError) {
        let r = try await client.pollSyncSetup(start)
        if r.state == "pending" { continue }
        signingIn = nil
        pollTask = nil
        switch r.state {
        case "signed_in":
          relayChanged = r.relayChanged ?? false
          if let s = r.status {
            status = s
            loadState = .loaded
          } else {
            await refresh()
          }
        case "denied": signInError = "Sign-in was declined on the Clerk page."
        case "expired": signInError = "The code expired before it was approved. Start again."
        default: signInError = r.error ?? "Sign-in did not finish."
        }
        return
      } catch {
        guard error != .cancelled else { return }
        signingIn = nil
        pollTask = nil
        signInError = error.message
        return
      }
    }
  }

  // MARK: Path map

  public func addMapping() {
    mappings.append(SyncPathMapping())
  }

  public func removeMapping(_ id: SyncPathMapping.ID) {
    mappings.removeAll { $0.id == id }
  }

  /// Saves the rows that have anything in them. The server tidies them, and the rows show what it kept.
  public func saveMappings() async {
    guard !isSavingMappings else { return }
    var map: [String: String] = [:]
    for m in mappings where !trimmed(m.from).isEmpty || !trimmed(m.to).isEmpty { map[trimmed(m.from)] = trimmed(m.to) }
    isSavingMappings = true
    mappingsError = nil
    defer { isSavingMappings = false }
    do throws(OmniAPIError) {
      let kept = try await client.setSyncPathMap(map)
      mappings = kept.sorted { $0.key < $1.key }.map { SyncPathMapping(from: $0.key, to: $0.value) }
      mappingsSaved = true
    } catch {
      if error != .cancelled { mappingsError = error.message }
    }
  }

  private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
}
