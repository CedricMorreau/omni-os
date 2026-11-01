import Foundation
import Testing
import OmniKit

@Suite struct LegacyLaunchAgentTests {
  /// A launchctl that logs its arguments and reports the agent as gone.
  private func fakeAgent(in dir: TempDir) -> LegacyLaunchAgent {
    let log = dir.path("launchctl.log").path
    let launchctl = dir.script("bin/launchctl", """
      echo "$@" >> '\(log)'
      [ "$1" = "print" ] && exit 113
      exit 0
      """)
    return LegacyLaunchAgent(
      plist: dir.path("LaunchAgents/com.omni-os.server.plist"), launchctl: launchctl.path, domain: "gui/501", settle: .seconds(2)
    )
  }

  @Test func bootsOutTheAgentAndMovesItsPlistAside() async {
    let dir = TempDir("launch-agent")
    defer { dir.remove() }
    dir.write("LaunchAgents/com.omni-os.server.plist", "<plist/>")
    let agent = fakeAgent(in: dir)
    #expect(await agent.retire())
    #expect(!FileManager.default.fileExists(atPath: agent.plist.path))
    #expect(dir.read("LaunchAgents/com.omni-os.server.plist.disabled") == "<plist/>")
    let calls = dir.read("launchctl.log").split(separator: "\n").map(String.init)
    #expect(calls == ["bootout gui/501/com.omni-os.server", "print gui/501/com.omni-os.server"])
  }

  @Test func doesNothingWithoutAnAgent() async {
    let dir = TempDir("launch-agent")
    defer { dir.remove() }
    let agent = fakeAgent(in: dir)
    #expect(await agent.retire() == false)
    #expect(dir.read("launchctl.log").isEmpty)
  }
}
