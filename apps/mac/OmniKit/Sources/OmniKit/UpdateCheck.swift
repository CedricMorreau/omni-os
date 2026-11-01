import Foundation

/// Which parts are behind the repo's main.
public struct UpdateNotices: Hashable, Sendable {
  public var serverBehind = false
  public var appBehind = false
  /// How many commits on main the further behind of the two lacks. nil when git can't say.
  public var behindBy: Int?

  public init(serverBehind: Bool = false, appBehind: Bool = false, behindBy: Int? = nil) {
    self.serverBehind = serverBehind
    self.appBehind = appBehind
    self.behindBy = behindBy
  }

  public var isEmpty: Bool { !serverBehind && !appBehind }

  /// The Update row's line.
  public var label: String {
    switch behindBy {
    case .some(1): "Omni has 1 new commit on main."
    case .some(let n) where n > 1: "Omni has \(n) new commits on main."
    default: "An update is ready."
    }
  }
}

public enum UpdateCheck {
  /// The line that says why build-mac.sh or sync-main.sh failed: the last of their own error lines, else the
  /// last line with text.
  public static func failureLine(_ tail: [String]) -> String? {
    tail.last { $0.hasPrefix("build-mac:") || $0.hasPrefix("sync-main:") } ?? tail.last { !$0.isEmpty }
  }

  /// Two commit ids name the same commit: equal, or one is an abbreviation of the other (7 characters or more).
  public static func same(_ a: String, _ b: String) -> Bool {
    let (a, b) = (a.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), b.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    guard !a.isEmpty, !b.isEmpty else { return false }
    if a == b { return true }
    let (short, long) = a.count <= b.count ? (a, b) : (b, a)
    return short.count >= 7 && long.hasPrefix(short)
  }

  /// A notice shows when a commit is known, differs from main's and does not already contain main. A commit
  /// the check can't know (a server older than #76, a build without a stamp, no main) never shows one.
  /// `containsMain` says, per commit, whether main is among its ancestors: a branch ahead of main is not behind,
  /// and Restart or Rebuild from that checkout could never clear it. A commit missing from it counts as not.
  public static func notices(
    serverHead: String?, appCommit: String?, mainHead: String?, containsMain: [String: Bool] = [:]
  ) -> UpdateNotices {
    guard let main = mainHead, !main.isEmpty else { return UpdateNotices() }
    func behind(_ commit: String?) -> Bool {
      guard let commit, !commit.isEmpty else { return false }
      return !same(commit, main) && containsMain[commit] != true
    }
    return UpdateNotices(serverBehind: behind(serverHead), appBehind: behind(appCommit))
  }
}

public enum RepoHead {
  private static func git(_ repo: URL, _ arguments: [String], timeout: Duration = .seconds(5)) async -> (status: Int32?, text: String)? {
    let out = await Spawn.capture(
      "/usr/bin/git", ["-C", repo.path] + arguments,
      environment: ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin"], timeout: timeout
    )
    guard let out else { return nil }
    return (out.status, String(decoding: out.output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private static func commit(_ repo: URL, _ ref: String) async -> String? {
    guard let out = await git(repo, ["rev-parse", "--verify", "--quiet", "\(ref)^{commit}"]), out.status == 0 else { return nil }
    return out.text.isEmpty ? nil : out.text
  }

  /// main's newest commit known here: origin/main when it contains the local main (or there is no local main),
  /// else the local main. nil when git can't say. The server's `mainHead` (apps/server/update.ts) picks the same.
  public static func main(repo: URL) async -> String? {
    let local = await commit(repo, "refs/heads/main")
    guard let remote = await commit(repo, "refs/remotes/origin/main") else { return local }
    guard let local else { return remote }
    return await contains(repo: repo, commit: remote, ancestor: local) == true ? remote : local
  }

  /// Asks origin for its main. False when it could not, like offline.
  @discardableResult
  public static func fetch(repo: URL) async -> Bool {
    await git(repo, ["fetch", "--quiet", "origin", "main"], timeout: .seconds(30))?.status == 0
  }

  /// How many commits `target` has that `commit` lacks, nil when git can't say.
  public static func count(repo: URL, from commit: String, to target: String) async -> Int? {
    guard let out = await git(repo, ["rev-list", "--count", "\(commit)..\(target)"]), out.status == 0 else { return nil }
    return Int(out.text)
  }

  /// Whether `ancestor` is in `commit`'s history, nil when git can't say (an unknown commit, no repo).
  public static func contains(repo: URL, commit: String, ancestor: String) async -> Bool? {
    let out = await Spawn.capture(
      "/usr/bin/git", ["-C", repo.path, "merge-base", "--is-ancestor", ancestor, commit],
      environment: ["HOME": NSHomeDirectory(), "PATH": "/usr/bin:/bin"], timeout: .seconds(5)
    )
    switch out?.status {
    case 0: return true
    case 1: return false
    default: return nil
    }
  }
}

public enum AppBuild {
  /// The commit `scripts/build-mac.sh` stamped into this app. nil for a build that was not stamped.
  public static var commit: String? {
    let value = Bundle.main.object(forInfoDictionaryKey: "OmniGitCommit") as? String
    return value?.isEmpty == false ? value : nil
  }
}
