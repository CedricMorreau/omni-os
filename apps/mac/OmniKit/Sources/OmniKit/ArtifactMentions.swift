import Foundation

public enum ArtifactMentions {
  public static func match(_ text: String, in artifacts: [Artifact]) -> Artifact? {
    guard !artifacts.isEmpty else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let name = trimmed.contains("/") ? String(trimmed.split(separator: "/", omittingEmptySubsequences: false).last ?? "") : trimmed
    guard !name.isEmpty else { return nil }
    return artifacts.filter { $0.name == name }.max { $0.updatedAt < $1.updatedAt }
  }
}

public enum DownloadName {
  public static func free(_ name: String, fallback: String = "download", exists: (String) -> Bool) -> String {
    let base = (name as NSString).lastPathComponent
    let first = base.isEmpty ? fallback : base
    guard exists(first) else { return first }
    let ext = (first as NSString).pathExtension
    let stem = (first as NSString).deletingPathExtension
    var n = 1
    while true {
      let next = "\(stem) (\(n))" + (ext.isEmpty ? "" : ".\(ext)")
      if !exists(next) { return next }
      n += 1
    }
  }
}
