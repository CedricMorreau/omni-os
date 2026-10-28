import OmniKit
import SwiftUI

/// RunningSubagents.tsx: the agents a thread spawned itself that still run, under the Details tab's resume command. Nothing
/// when none run. A row scrolls the transcript to the call that started it, loading that page when it is far back.
struct RunningSubagentsSection: View {
  let agents: [OmniKit.BackgroundTask]
  let jump: (Int) -> Void

  var body: some View {
    if !agents.isEmpty {
      VStack(alignment: .leading, spacing: z(6)) {
        HStack {
          Text("Running subagents").omniCaption()
          Spacer()
          Text("\(agents.count)").font(.omni(size: 11)).monospacedDigit().foregroundStyle(Tok.fg3)
        }
        .padding(.horizontal, z(8))
        VStack(spacing: 0) {
          ForEach(agents) { SubagentRow(task: $0, jump: jump) }
        }
        .padding(z(4))
        .background(Tok.bg, in: RoundedRectangle(cornerRadius: z(20), style: .continuous))
      }
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Running subagents")
      #if DEBUG
      .onAppear { QAProbe.jumpSubagent = press }
      .onChange(of: agents) { QAProbe.jumpSubagent = press }
      .onDisappear { QAProbe.jumpSubagent = nil }
      #endif
    }
  }

  #if DEBUG
  /// What a click on the row at an index does, for the QA runner's `subagent` step.
  private func press(_ i: Int) -> (thread: String, at: Int)? {
    guard agents.indices.contains(i), let at = agents[i].eventID else { return nil }
    jump(at)
    return (agents[i].threadID, at)
  }
  #endif
}

/// SubagentRow in RunningSubagents.tsx: what it does, its kind and how long it has run.
private struct SubagentRow: View {
  let task: OmniKit.BackgroundTask
  let jump: (Int) -> Void

  var body: some View {
    Button {
      if let at = task.eventID { jump(at) }
    } label: {
      TimelineView(.periodic(from: .now, by: 1)) { context in
        HStack(spacing: z(8)) {
          Loader(size: 11, color: Tok.live).accessibilityHidden(true)
          Text(task.description).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
          if let kind = task.kind {
            Text(kind).font(.omni(size: 11, design: .monospaced)).foregroundStyle(Tok.fg4).lineLimit(1)
          }
          Text(Format.duration(ms: max(0, context.date.timeIntervalSince(task.startedAt) * 1000)))
            .font(.omni(size: 11).monospacedDigit())
            .foregroundStyle(Tok.fg3)
        }
        .padding(.horizontal, z(12))
        .frame(height: z(36))
        .contentShape(Capsule())
        .rowHover(radius: 18)
      }
    }
    .buttonStyle(.plain)
    .disabled(task.eventID == nil)
    .help(tip)
    .accessibilityLabel("Subagent: \(task.description)")
  }

  private var tip: String {
    var parts = [task.description]
    if task.background { parts.append("in the background") }
    if let uses = task.toolUses, uses > 0 { parts.append(Format.plural(uses, "tool call")) }
    if let last = task.lastTool { parts.append("last \(last)") }
    return parts.joined(separator: " · ") + (task.eventID != nil ? "\nJump to where it started" : "")
  }
}
