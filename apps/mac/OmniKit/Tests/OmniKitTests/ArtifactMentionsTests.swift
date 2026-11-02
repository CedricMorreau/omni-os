import Foundation
import Testing
import OmniKit

private func artifact(_ id: Int, _ name: String, updated: String = "2026-09-28T07:57:15.045Z") throws -> Artifact {
  try decode(Artifact.self, """
    {"id":\(id),"thread_id":"t1","path":"/d/threads/t1/artifacts/\(name)","name":"\(name)","kind":"csv","size":12,
     "created_at":"2026-09-28T07:57:15.045Z","updated_at":"\(updated)"}
    """)
}

@Suite struct ArtifactMentionsTests {
  @Test func matchesANameOrAPathEndingInIt() throws {
    let list = [try artifact(1, "acme-report.csv"), try artifact(2, "notes.md")]
    #expect(ArtifactMentions.match("acme-report.csv", in: list)?.id == 1)
    #expect(ArtifactMentions.match(" acme-report.csv ", in: list)?.id == 1)
    #expect(ArtifactMentions.match("data/threads/t1/artifacts/notes.md", in: list)?.id == 2)
    #expect(ArtifactMentions.match("acme-report", in: list) == nil)
    #expect(ArtifactMentions.match("See acme-report.csv", in: list) == nil)
    #expect(ArtifactMentions.match("folder/", in: list) == nil)
    #expect(ArtifactMentions.match("acme-report.csv", in: []) == nil)
    let newer = [try artifact(1, "acme-report.csv"), try artifact(5, "acme-report.csv", updated: "2026-10-01T07:57:15.045Z")]
    #expect(ArtifactMentions.match("acme-report.csv", in: newer)?.id == 5)
  }

  @Test func picksAFreeDownloadName() {
    let taken: Set<String> = ["acme.csv", "acme (1).csv", "README"]
    #expect(DownloadName.free("acme.csv") { taken.contains($0) } == "acme (2).csv")
    #expect(DownloadName.free("new.csv") { taken.contains($0) } == "new.csv")
    #expect(DownloadName.free("README") { taken.contains($0) } == "README (1)")
    #expect(DownloadName.free("") { _ in false } == "download")
    #expect(DownloadName.free("a/b/acme.csv") { _ in false } == "acme.csv")
  }
}
