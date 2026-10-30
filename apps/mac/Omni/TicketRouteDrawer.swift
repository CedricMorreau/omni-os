import OmniKit
import SwiftUI

struct TicketRouteDrawer: View {
  let client: OmniClient
  let store: ThreadStore
  let holder: ThreadTicket
  let panels: ThreadPanelsModel

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var open: Bool { panels.state.isOpen(.route) }

  var body: some View {
    if let ticket = holder.ticket {
      ZStack(alignment: .top) {
        if open {
          Color.clear
            .contentShape(Rectangle())
            .onTapGesture { setOpen(false) }
            .accessibilityHidden(true)
        }
        VStack(spacing: 0) {
          if open {
            TicketRouteCard(client: client, store: store, holder: holder)
              .menuShadow(24)
              .frame(maxWidth: ThreadStyle.thread)
              .padding(.horizontal, z(24))
              .padding(.top, z(8))
              .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
          }
          tab(ticket)
        }
      }
      .onChange(of: ticket.routeProposal, initial: true) { _, proposal in
        withAnimation(animation) { panels.state.proposalChanged(proposal) }
      }
    }
  }

  private var animation: Animation {
    reduceMotion ? .easeInOut(duration: 0.15) : Motion.settle
  }

  private func tab(_ ticket: Ticket) -> some View {
    let deciding = ticket.closedAt == nil && ticket.routeProposal != nil
    return Button {
      setOpen(!open)
    } label: {
      HStack(spacing: z(8)) {
        if !ticket.ref.isEmpty {
          Text(ticket.ref)
            .font(.omni(size: 12, weight: .medium).monospacedDigit())
            .foregroundStyle(Tok.fg)
        }
        StagePill(text: ticket.stageLabel, phase: ticket.phase)
        if deciding {
          Circle().fill(Tok.needs).frame(width: z(7), height: z(7))
        }
        OmniIcon(name: "chevronDown", size: 12)
          .foregroundStyle(Tok.fg3)
          .rotationEffect(.degrees(open ? 180 : 0))
      }
      .padding(.horizontal, z(14))
      .frame(height: z(30))
      .background(Tok.elev, in: UnevenRoundedRectangle(bottomLeadingRadius: z(12), bottomTrailingRadius: z(12), style: .continuous))
      .menuShadow(12)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .keyboardShortcut(open ? .cancelAction : nil)
    .padding(.top, open ? z(6) : 0)
    .help(open ? "Hide the route" : "Show the route")
    .accessibilityLabel(open ? "Hide the ticket route" : deciding ? "Show the ticket route, a route waits for your decision" : "Show the ticket route")
  }

  private func setOpen(_ value: Bool) {
    withAnimation(animation) {
      if value { panels.state.open(.route) } else { panels.state.close() }
    }
  }
}
