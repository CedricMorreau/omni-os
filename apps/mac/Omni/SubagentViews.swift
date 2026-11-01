import OmniKit
import SwiftUI

/// SubagentRow in RunningSubagents.tsx: what it does, its kind and how long it has run.
/// The Details tab's agents card (`AgentsCard` in InspectorBranch.swift) lists one per running sub-agent.
struct SubagentRow: View {
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
