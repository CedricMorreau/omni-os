import OmniKit
import SwiftUI

@MainActor @Observable
final class DraftSeenStore {
  static let shared = DraftSeenStore()
  var seen = DraftSeen()
}

struct TicketDraftDrawer: View {
  let threadID: String
  let holder: ThreadTicket
  let panels: ThreadPanelsModel

  private var open: Bool { panels.state.isOpen(.draft) }
  @State private var copied = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    if let note = holder.ticket?.draft, !note.text.isEmpty {
      HStack(alignment: .center, spacing: 0) {
        tab(note)
        if open {
          panel(note)
            .transition(reduceMotion ? .opacity : .move(edge: .trailing))
        }
      }
      .frame(maxHeight: .infinity)
      .padding(.leading, z(40))
      .clipped()
      .onChange(of: note.text) { _, text in
        if open { DraftSeenStore.shared.seen.markSeen(text, in: threadID) }
      }
    }
  }

  private func tab(_ note: Ticket.Draft) -> some View {
    let unseen = !open && DraftSeenStore.shared.seen.isUnseen(note.text, in: threadID)
    return Button {
      toggle(note)
    } label: {
      VStack(spacing: z(8)) {
        OmniIcon(name: "message", size: 13)
        Text(note.label)
          .font(.omni(size: 11, weight: .medium))
          .lineLimit(1)
          .fixedSize()
          .rotationEffect(.degrees(-90))
          .frame(width: z(16), height: z(110))
      }
      .foregroundStyle(open ? Tok.fg : Tok.fg2)
      .padding(.vertical, z(12))
      .frame(width: z(30))
      .floatingPanel(UnevenRoundedRectangle(topLeadingRadius: z(Tok.panelRadius), bottomLeadingRadius: z(Tok.panelRadius), style: .continuous))
      .overlay(alignment: .topLeading) {
        if unseen {
          Circle().fill(Tok.needs).frame(width: z(8), height: z(8)).offset(x: z(4), y: z(4))
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help(open ? "Hide the \(note.label)" : "Show the \(note.label)")
    .accessibilityLabel(open ? "Hide \(note.label)" : unseen ? "Show \(note.label), changed" : "Show \(note.label)")
  }

  private func panel(_ note: Ticket.Draft) -> some View {
    VStack(alignment: .leading, spacing: z(12)) {
      HStack(spacing: z(8)) {
        Text(note.label)
          .font(.omni(size: 14, weight: .medium))
          .foregroundStyle(Tok.fg)
        Spacer(minLength: z(8))
        Button {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(note.text, forType: .string)
          copied = true
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: copied ? "check" : "copy", size: 12)
            Text(copied ? "Copied" : "Copy")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .accessibilityLabel(copied ? "Copied \(note.label)" : "Copy \(note.label)")
        Button {
          toggle(note)
        } label: {
          OmniIcon(name: "x", size: 14)
        }
        .buttonStyle(.icon(size: 28))
        .keyboardShortcut(.cancelAction)
        .help("Close")
        .accessibilityLabel("Close \(note.label)")
      }
      ScrollView {
        Text(note.text)
          .font(.omni(size: 13))
          .foregroundStyle(Tok.fg)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .accessibilityLabel("\(note.label) text")
    }
    .padding(z(16))
    .frame(width: z(380))
    .frame(maxHeight: .infinity, alignment: .top)
    .floatingPanel(UnevenRoundedRectangle(topLeadingRadius: z(Tok.panelRadius), bottomLeadingRadius: z(Tok.panelRadius), style: .continuous))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(note.label)
  }

  private func toggle(_ note: Ticket.Draft) {
    if !open { DraftSeenStore.shared.seen.markSeen(note.text, in: threadID) }
    withAnimation(reduceMotion ? .easeInOut(duration: 0.15) : Motion.settle) { panels.state.toggle(.draft) }
  }
}
