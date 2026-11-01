import Darwin
import Foundation

/// The LaunchAgent the old `scripts/install-launchd.sh` installed. The app owns the server now, and the agent's
/// KeepAlive would start a server again each time the app stopped its own, so the app retires it once: boot it out
/// and move its plist aside to `<plist>.disabled`. Nothing is deleted.
public struct LegacyLaunchAgent: Sendable {
  public static let label = "com.omni-os.server"

  public var plist: URL
  public var launchctl: String
  /// The launchd domain, `gui/<uid>`.
  public var domain: String
  /// How long to wait for launchd to let go of the agent after the bootout.
  public var settle: Duration

  public init(
    plist: URL = URL.homeDirectory.appending(path: "Library/LaunchAgents/\(LegacyLaunchAgent.label).plist"),
    launchctl: String = "/bin/launchctl", domain: String = "gui/\(getuid())", settle: Duration = .seconds(5)
  ) {
    self.plist = plist
    self.launchctl = launchctl
    self.domain = domain
    self.settle = settle
  }

  public var disabledPlist: URL { plist.appendingPathExtension("disabled") }

  /// Boots the agent out and moves its plist aside. False when there was none.
  @discardableResult
  public func retire() async -> Bool {
    guard FileManager.default.fileExists(atPath: plist.path) else { return false }
    let service = "\(domain)/\(Self.label)"
    let env = ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin"]
    _ = await Spawn.capture(launchctl, ["bootout", service], environment: env, timeout: .seconds(10))
    // bootout returns before the job is gone, and its server may still hold the port.
    let end = ContinuousClock.now + settle
    while ContinuousClock.now < end {
      let loaded = await Spawn.capture(launchctl, ["print", service], environment: env, timeout: .seconds(5))
      guard loaded?.status == 0 else { break }
      try? await Task.sleep(for: .milliseconds(250))
    }
    try? FileManager.default.removeItem(at: disabledPlist)
    try? FileManager.default.moveItem(at: plist, to: disabledPlist)
    return true
  }
}
