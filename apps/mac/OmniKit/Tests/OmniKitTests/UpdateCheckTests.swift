import Testing
import OmniKit

@Suite struct UpdateCheckTests {
  let main = "3259341aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  @Test func showsForACommitThatDiffersAndClearsWhenItMatches() {
    let behind = UpdateCheck.notices(serverHead: "14ff270bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", appCommit: main, mainHead: main)
    #expect(behind == UpdateNotices(serverBehind: true, appBehind: false))
    let app = UpdateCheck.notices(serverHead: main, appCommit: "14ff270bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", mainHead: main)
    #expect(app == UpdateNotices(serverBehind: false, appBehind: true))
    #expect(UpdateCheck.notices(serverHead: main, appCommit: main, mainHead: main).isEmpty)
  }

  @Test func aCommitAheadOfMainIsNotBehind() {
    let branch = "275f906bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    let ahead = UpdateCheck.notices(serverHead: branch, appCommit: branch, mainHead: main, containsMain: [branch: true])
    #expect(ahead.isEmpty)
    let lacking = UpdateCheck.notices(serverHead: branch, appCommit: branch, mainHead: main, containsMain: [branch: false])
    #expect(lacking == UpdateNotices(serverBehind: true, appBehind: true))
  }

  @Test func whatItCannotKnowNeverShows() {
    #expect(UpdateCheck.notices(serverHead: nil, appCommit: nil, mainHead: main).isEmpty)
    #expect(UpdateCheck.notices(serverHead: "", appCommit: "", mainHead: main).isEmpty)
    #expect(UpdateCheck.notices(serverHead: "abc1234", appCommit: "def5678", mainHead: nil).isEmpty)
  }

  @Test func anAbbreviationMatchesButOnlyFromSevenCharacters() {
    #expect(UpdateCheck.same("3259341", main + "\n"))
    #expect(UpdateCheck.same("3259341AAA", main))
    #expect(!UpdateCheck.same("32593", main))
    #expect(!UpdateCheck.same("3259342", main))
  }

  @Test func theLineSaysHowManyCommitsWhenItKnows() {
    #expect(UpdateNotices(serverBehind: true, behindBy: 3).label == "Omni has 3 new commits on main.")
    #expect(UpdateNotices(appBehind: true, behindBy: 1).label == "Omni has 1 new commit on main.")
    #expect(UpdateNotices(serverBehind: true).label == "An update is ready.")
    #expect(UpdateNotices(serverBehind: true, behindBy: 0).label == "An update is ready.")
  }

  @Test func failureLinePrefersTheScriptsOwnErrorLines() {
    let tail = ["==> Updating the checkout to main", "sync-main: the checkout has uncommitted changes on wip. Commit or stash them, then try again.", ""]
    #expect(UpdateCheck.failureLine(tail) == tail[1])
    #expect(UpdateCheck.failureLine(["build-mac: the build failed. Full log: x", "** BUILD FAILED **"]) == "build-mac: the build failed. Full log: x")
    #expect(UpdateCheck.failureLine(["something else", ""]) == "something else")
    #expect(UpdateCheck.failureLine([]) == nil)
  }
}
