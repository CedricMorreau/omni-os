import Foundation
import Testing
import OmniKit

/// A thread branch's PR, open, mergeable and green unless a field says otherwise.
private func pr(state: String = "OPEN", draft: Bool = false, mergeable: String = "MERGEABLE", review: String? = nil, passed: Int = 3, failed: Int = 0, pending: Int = 0) throws -> PullRequestSummary {
  let reviewJSON = review.map { "\"\($0)\"" } ?? "null"
  return try decode(
    PullRequestSummary.self,
    #"{"number":481,"title":"Panel","author":null,"headRefName":"t3/x","baseRefName":"main","state":"\#(state)","isDraft":\#(draft),"updatedAt":"2026-11-01T18:00:00.000Z","reviewDecision":\#(reviewJSON),"url":"https://github.com/o/r/pull/481","additions":4,"deletions":1,"mergeable":"\#(mergeable)","checks":{"passed":\#(passed),"failed":\#(failed),"pending":\#(pending)}}"#)
}

/// The inspector's branch card, as thread-glance.test.ts in apps/web/tests.
@Suite struct ThreadGlanceTests {
  @Test func opensAPROnlyWhenTheBranchHasChanges() {
    #expect(ThreadGlance.next(nil, hasChanges: true) == .open)
    #expect(ThreadGlance.next(nil, hasChanges: false) == nil)
    #expect(ThreadGlance.Next.open.prompt == "Commit your work, push the branch and open a PR with gh. Reply with the PR URL.")
  }

  @Test func fixesConflictsBeforeChecksAndChecksBeforeMerging() throws {
    #expect(ThreadGlance.next(try pr(mergeable: "CONFLICTING", failed: 2), hasChanges: true) == .conflicts)
    #expect(ThreadGlance.next(try pr(failed: 2), hasChanges: true) == .checks)
    #expect(ThreadGlance.next(try pr(), hasChanges: true) == .merge)
    #expect(ThreadGlance.Next.merge.prompt == nil)
  }

  @Test func waitsOnRunningChecksAndDraftsAndIgnoresAClosedPR() throws {
    #expect(ThreadGlance.next(try pr(pending: 1), hasChanges: true) == nil)
    #expect(ThreadGlance.next(try pr(draft: true), hasChanges: true) == nil)
    #expect(ThreadGlance.next(try pr(state: "MERGED"), hasChanges: true) == nil)
    #expect(ThreadGlance.next(try pr(state: "CLOSED"), hasChanges: true) == nil)
  }

  @Test func saysWhatDecidesWhetherItCanMerge() throws {
    #expect(ThreadGlance.line(try pr()) == ("3 checks passed", .live))
    #expect(ThreadGlance.line(try pr(review: "APPROVED")).text == "3 checks passed · approved")
    #expect(ThreadGlance.line(try pr(mergeable: "CONFLICTING")) == ("Conflicts with the base branch", .needs))
    #expect(ThreadGlance.line(try pr(passed: 1, failed: 1, pending: 1)) == ("1 of 3 checks failing", .needs))
    #expect(ThreadGlance.line(try pr(passed: 2, pending: 1)) == ("1 of 3 checks running", .live))
    #expect(ThreadGlance.line(try pr(state: "MERGED")) == ("Merged", .done))
  }
}
