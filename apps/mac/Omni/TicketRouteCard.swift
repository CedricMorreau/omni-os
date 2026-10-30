import OmniKit
import SwiftUI

@MainActor @Observable
final class ThreadTicket {
  var ticket: Ticket?

  func load(_ client: OmniClient, threadID: String) async {
    do {
      ticket = try await client.ticket(threadID: threadID)
    } catch {
      return
    }
  }
}

@MainActor @Observable
final class ThreadPanelsModel {
  var state = ThreadPanels()
}

struct TicketWatcher: View {
  let client: OmniClient
  let store: ThreadStore
  let holder: ThreadTicket

  private struct Watch: Hashable {
    let id: String
    let status: ThreadStatus?
    let tail: Int
  }

  var body: some View {
    Color.clear
      .frame(height: 0)
      .task(id: Watch(id: store.id, status: store.thread?.status, tail: store.history.tailID)) {
        if holder.ticket != nil {
          try? await Task.sleep(for: .milliseconds(400))
          guard !Task.isCancelled else { return }
        }
        await holder.load(client, threadID: store.id)
      }
      .accessibilityHidden(true)
  }
}

struct TicketRouteCard: View {
  let client: OmniClient
  let store: ThreadStore
  let holder: ThreadTicket

  private var ticket: Ticket? {
    get { holder.ticket }
    nonmutating set { holder.ticket = newValue }
  }
  @State private var draft: TicketRouteDraft?
  @State private var saving = false
  @State private var error: String?
  @State private var confirmingClose = false

  var body: some View {
    if let ticket {
      card(ticket)
        .onChange(of: ticket.routeProposal) { _, _ in draft = nil }
    }
  }

  @ViewBuilder private func card(_ ticket: Ticket) -> some View {
    let mode = ticket.closedAt == nil ? TicketRoute.mode(ticket) : .set(ticket.route ?? [])
    let deciding = ticket.closedAt == nil && ticket.routeProposal != nil
    VStack(alignment: .leading, spacing: z(10)) {
      header(ticket, mode: mode, deciding: deciding)
      switch mode {
      case .reading:
        HStack(spacing: z(8)) {
          Loader(size: 12)
          Text("Claude is reading the ticket and will propose a route.")
        }
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
        .accessibilityElement(children: .combine)
      case .proposed(let proposal):
        let shown = draft ?? TicketRouteDraft(proposal.stages)
        Text("Proposed route")
          .font(.omni(size: 13.5, weight: .medium))
          .foregroundStyle(Tok.fg)
        stageList(shown, proposal: proposal)
        HStack(spacing: z(10)) {
          Spacer()
          saveButton("Confirm route", draft: shown)
        }
      case .set:
        if let draft {
          stageList(draft, proposal: nil)
          HStack(spacing: z(10)) {
            Spacer()
            Button("Cancel") {
              self.draft = nil
              error = nil
            }
            .buttonStyle(.pill(.ghost, height: 28))
            .disabled(saving)
            .accessibilityLabel("Cancel the route edit")
            saveButton("Save route", draft: draft)
          }
        } else {
          chips(ticket)
        }
      }
      if confirmingClose, TicketRoute.canClose(ticket) {
        closeConfirmation
      }
      if let error { ErrorNote(text: error) }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.elev, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
    .overlay {
      if deciding {
        RoundedRectangle(cornerRadius: z(18), style: .continuous).strokeBorder(Tok.needs.opacity(0.7))
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Ticket route")
  }

  private func header(_ ticket: Ticket, mode: TicketRoute.Mode, deciding: Bool) -> some View {
    let parts = TicketRoute.header(ticket)
    return HStack(spacing: z(8)) {
      Text(parts.first ?? "")
        .font(.omni(size: 12.5, weight: .medium).monospacedDigit())
        .foregroundStyle(Tok.fg)
      Text(parts.dropFirst().joined(separator: "  ·  "))
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg3)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: z(8))
      if deciding {
        Chip(text: "Decide", tone: .needs)
          .accessibilityLabel("Needs your decision")
      }
      if TicketRoute.canClose(ticket), draft == nil, !confirmingClose {
        Button {
          error = nil
          confirmingClose = true
        } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: "check", size: 12)
            Text("Close ticket")
          }
        }
        .buttonStyle(.pill(.secondary, height: 26))
        .disabled(saving)
        .accessibilityLabel("Close ticket")
      }
      if ticket.closedAt == nil, case .set(let route) = mode, draft == nil {
        Button {
          error = nil
          draft = TicketRouteDraft(route)
        } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: "pencil", size: 12)
            Text("Edit route")
          }
        }
        .buttonStyle(.pill(.ghost, height: 26))
        .accessibilityLabel("Edit route")
      }
    }
    .accessibilityElement(children: .contain)
  }

  private var closeConfirmation: some View {
    HStack(spacing: z(10)) {
      Text("Close this ticket? Claude tidies its memory and archives the thread.")
        .font(.omni(size: 12.5))
        .foregroundStyle(Tok.fg2)
        .frame(maxWidth: .infinity, alignment: .leading)
      Button("Cancel") { confirmingClose = false }
        .buttonStyle(.pill(.ghost, height: 28))
        .disabled(saving)
        .accessibilityLabel("Cancel closing the ticket")
      Button {
        Task { await close() }
      } label: {
        HStack(spacing: z(8)) {
          if saving { Loader(size: 12) }
          Text("Close ticket")
        }
      }
      .buttonStyle(.pill(.primary, height: 28))
      .disabled(saving)
      .accessibilityLabel("Confirm close ticket")
    }
  }

  private func stageList(_ shown: TicketRouteDraft, proposal: Ticket.RouteProposal?) -> some View {
    VStack(alignment: .leading, spacing: z(6)) {
      ForEach(TicketStage.all) { stage in
        let on = shown.contains(stage.number)
        HStack(alignment: .firstTextBaseline, spacing: z(10)) {
          Toggle(isOn: Binding { on } set: { _ in toggle(stage.number, from: shown) }) {
            EmptyView()
          }
          .toggleStyle(.omni)
          .disabled(saving)
          .accessibilityLabel("Stage \(stage.number), \(stage.name)")
          Text("\(stage.number)  \(stage.name)")
            .font(.omni(size: 13))
            .foregroundStyle(on ? Tok.fg : Tok.fg3)
            .lineLimit(1)
            .fixedSize()
            .accessibilityHidden(true)
          if !on, let reason = proposal?.reason(stage.number) {
            Text(reason)
              .font(.omni(size: 12))
              .foregroundStyle(Tok.fg4)
              .lineLimit(2)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private func chips(_ ticket: Ticket) -> some View {
    FlowLayout(spacing: z(4)) {
      ForEach(TicketStage.all) { stage in
        let state = TicketRoute.state(of: stage.number, in: ticket)
        StageChip(stage: stage, state: state)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func saveButton(_ title: String, draft shown: TicketRouteDraft) -> some View {
    Button {
      Task { await save(shown.sorted) }
    } label: {
      HStack(spacing: z(8)) {
        if saving { Loader(size: 12) }
        Text(title)
      }
    }
    .buttonStyle(.pill(.primary, height: 28))
    .disabled(saving || !shown.canSave)
    .accessibilityLabel(title)
  }

  private func toggle(_ stage: Int, from shown: TicketRouteDraft) {
    var next = shown
    next.toggle(stage)
    draft = next
  }

  private func load() async {
    await holder.load(client, threadID: store.id)
  }

  private func close() async {
    saving = true
    error = nil
    defer { saving = false }
    do {
      ticket = try await client.closeTicket(threadID: store.id)
      confirmingClose = false
    } catch {
      self.error = error.message
      return
    }
    await load()
  }

  private func save(_ stages: [Int]) async {
    saving = true
    error = nil
    defer { saving = false }
    do {
      ticket = try await client.setTicketRoute(threadID: store.id, stages: stages)
      draft = nil
    } catch {
      self.error = error.message
      return
    }
    await load()
  }
}

struct StagePill: View {
  let text: String
  let phase: TicketPhase
  var open: Bool?

  var body: some View {
    HStack(spacing: z(5)) {
      Text(text)
        .font(.omni(size: 11, weight: .medium).monospacedDigit())
        .lineLimit(1)
      if let open {
        OmniIcon(name: "chevronDown", size: 10)
          .rotationEffect(.degrees(open ? 180 : 0))
      }
    }
      .foregroundStyle(Tok.phase(phase))
      .padding(.horizontal, z(open == nil ? 8 : 11))
      .frame(height: z(open == nil ? 20 : 22))
      .background(Tok.phase(phase).opacity(0.14), in: Capsule())
      .fixedSize()
      .accessibilityLabel("Stage: \(text)")
  }
}

private struct StageChip: View {
  let stage: TicketStage
  let state: TicketRoute.StageState

  var body: some View {
    Text("\(stage.number)  \(stage.name)")
      .font(.omni(size: 11, weight: state == .current ? .medium : .regular).monospacedDigit())
      .strikethrough(state == .off, color: Tok.fg4)
      .lineLimit(1)
      .foregroundStyle(fg)
      .padding(.horizontal, z(8))
      .frame(minWidth: z(22), minHeight: z(20))
      .background(bg, in: Capsule())
      .overlay {
        if state == .off { Capsule().strokeBorder(Tok.line) }
        if state == .ahead { Capsule().strokeBorder(color.opacity(0.4)) }
      }
      .help(stage.name)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Stage \(stage.number), \(stage.name), \(label)")
  }

  private var label: String {
    switch state {
    case .done: "done"
    case .current: "current stage"
    case .ahead: "on the route"
    case .off: "not on the route"
    }
  }

  private var color: Color { Tok.phase(.of(stage: stage.number)) }

  private var fg: Color {
    switch state {
    case .done: color
    case .current: Tok.onLive
    case .ahead: color
    case .off: Tok.fg4
    }
  }

  private var bg: Color {
    switch state {
    case .done: color.opacity(0.16)
    case .current: color
    case .ahead, .off: .clear
    }
  }
}
