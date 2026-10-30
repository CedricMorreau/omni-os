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
              .frame(maxWidth: ThreadStyle.thread)
              .padding(.horizontal, z(24))
              .padding(.top, z(8))
              .transition(reduceMotion ? .opacity : .move(edge: .top))
          }
          if open {
            Button("Hide stages") { setOpen(false) }
              .keyboardShortcut(.cancelAction)
              .opacity(0)
              .frame(width: 0, height: 0)
              .accessibilityHidden(true)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .clipped()
      .onChange(of: ticket.routeProposal, initial: true) { _, proposal in
        withAnimation(animation) { panels.state.proposalChanged(proposal) }
      }
    }
  }

  private var animation: Animation {
    reduceMotion ? .easeInOut(duration: 0.15) : Motion.settle
  }

  private func setOpen(_ value: Bool) {
    withAnimation(animation) {
      if value { panels.state.open(.route) } else { panels.state.close() }
    }
  }
}
