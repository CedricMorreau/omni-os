import SwiftUI

/// `shell` in Composer.tsx: the surface card that lifts to the page color with an inset line and a wash ring on focus.
struct ComposerShell: ViewModifier {
  var radius: CGFloat = 12
  var focused = false
  var over = false

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    let lifted = focused || over
    content
      .background(lifted ? Tok.bg : Tok.surface, in: shape)
      .overlay { shape.strokeBorder(Tok.lineStrong, lineWidth: 1).opacity(lifted ? 1 : 0) }
      .background { RoundedRectangle(cornerRadius: radius + 4, style: .continuous).fill(Tok.wash).padding(z(-4)).opacity(lifted ? 1 : 0) }
      .overlay {
        if over {
          shape.fill(Tok.bg.opacity(0.85))
            .overlay {
              HStack(spacing: z(8)) {
                OmniIcon(name: "paperclip", size: 15)
                Text("Drop to attach")
              }
              .font(.omni(size: 13, weight: .medium))
              .foregroundStyle(Tok.fg2)
            }
            .allowsHitTesting(false)
        }
      }
      .animation(.easeOut(duration: 0.16), value: lifted)
  }
}

extension View {
  func composerShell(radius: CGFloat = 12, focused: Bool, over: Bool) -> some View {
    modifier(ComposerShell(radius: radius, focused: focused, over: over))
  }
}

/// Hint in Composer.tsx: the keys, quiet, beside the send button.
struct ComposerHints: View {
  /// The reply box shows a suggestion that Tab takes.
  var tab = false

  var body: some View {
    HStack(spacing: z(14)) {
      if tab { Text("⇥ use suggestion") }
      Text("↵ send")
      Text("⌘↵ newline")
      Text("/ commands")
      Text("@ files")
    }
    .font(.omni(size: 11.5))
    .foregroundStyle(Tok.fg4)
    .lineLimit(1)
    .fixedSize()
    .padding(.trailing, z(4))
    .accessibilityHidden(true)
  }
}

/// AttachButton in Composer.tsx: the paperclip as an icon button.
struct AttachButton: View {
  let disabled: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      OmniIcon(name: "paperclip", size: 15)
    }
    .buttonStyle(.icon(size: 30))
    .disabled(disabled)
    .help("Attach files")
    .accessibilityLabel("Attach files")
  }
}

/// The closed Picker in ui.tsx: a surface-2 pill with a 24pt lead, the name, a quiet second part and a chevron.
struct PickerPill<Lead: View>: View {
  let text: String
  var secondary: String?
  var chevron = true
  @ViewBuilder let lead: Lead
  @State private var hover = false

  var body: some View {
    HStack(spacing: z(8)) {
      lead.frame(width: z(24), height: z(24))
      Text(text).foregroundStyle(Tok.fg).lineLimit(1).truncationMode(.tail)
      if let secondary { Text("· \(secondary)").foregroundStyle(Tok.fg4).lineLimit(1) }
      if chevron { OmniIcon(name: "chevronDown", size: 13).foregroundStyle(Tok.fg4) }
    }
    .font(.omni(size: 12.5, weight: .medium))
    .padding(.leading, z(4))
    .padding(.trailing, z(10))
    .frame(height: z(32))
    .frame(maxWidth: z(240))
    .background(hover ? Tok.surface3 : Tok.surface2, in: Capsule())
    .contentShape(Capsule())
    .onHover { hover = $0 }
    .fixedSize()
  }
}

/// A lead for `PickerPill`: an icon in fg-3, no disc.
struct PillIcon: View {
  let name: String
  var body: some View { OmniIcon(name: name, size: 14).foregroundStyle(Tok.fg3) }
}

/// A lead for `PickerPill`: Avatar in ui.tsx, the name's first letter (or an icon) on a surface-2 disc,
/// or `lead` on the page color.
struct PillAvatar<Content: View>: View {
  var fill = Tok.surface2
  @ViewBuilder let content: Content

  var body: some View {
    content
      .font(.omni(size: 10, weight: .medium, design: .rounded))
      .foregroundStyle(Tok.fg2)
      .frame(width: z(24), height: z(24))
      .background(fill, in: Circle())
  }
}

/// The footer's `flex flex-wrap` with a `ml-auto` tail: subviews run left to right and wrap, and the last one
/// (the hints and send) sits at the right of whichever line it lands on.
struct ComposerFooterLayout: Layout {
  var spacing: CGFloat = 6
  var lineSpacing: CGFloat = 6
  var tailGap: CGFloat = 16

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    let plan = arrange(width: width, subviews: subviews)
    let height = plan.rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(0, plan.rows.count - 1))
    return CGSize(width: proposal.width ?? plan.rows.map(\.width).max() ?? 0, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let plan = arrange(width: bounds.width, subviews: subviews)
    var y = bounds.minY
    for row in plan.rows {
      var x = bounds.minX
      for i in row.items {
        let size = i == subviews.count - 1 ? plan.tail : subviews[i].sizeThatFits(.unspecified)
        if i == subviews.count - 1 { x = max(x, bounds.maxX - size.width) }
        subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  private struct Row {
    var items: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private struct Plan {
    var rows: [Row]
    var tail: CGSize
  }

  private func arrange(width: CGFloat, subviews: Subviews) -> Plan {
    guard let last = subviews.indices.last else { return Plan(rows: [Row()], tail: .zero) }
    let sizes = subviews.indices.dropLast().map { subviews[$0].sizeThatFits(.unspecified) }
    let full = subviews[last].sizeThatFits(.unspecified)
    let controls = sizes.map(\.width).reduce(0, +) + spacing * CGFloat(max(0, sizes.count - 1))
    if sizes.isEmpty || controls + tailGap + full.width <= width {
      let row = Row(
        items: Array(subviews.indices), width: controls + (sizes.isEmpty ? 0 : tailGap) + full.width,
        height: max(sizes.map(\.height).max() ?? 0, full.height))
      return Plan(rows: [row], tail: full)
    }
    var rows = [Row()]
    for (i, size) in sizes.enumerated() {
      let gap = rows[rows.count - 1].items.isEmpty ? 0 : spacing
      if !rows[rows.count - 1].items.isEmpty, rows[rows.count - 1].width + gap + size.width > width { rows.append(Row()) }
      let g = rows[rows.count - 1].items.isEmpty ? 0 : spacing
      rows[rows.count - 1].items.append(i)
      rows[rows.count - 1].width += size.width + g
      rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
    }
    let tail = subviews[last].sizeThatFits(ProposedViewSize(width: width.isFinite ? width : nil, height: nil))
    rows.append(Row(items: [last], width: tail.width, height: tail.height))
    return Plan(rows: rows, tail: tail)
  }
}

struct ComposerTail<Send: View>: View {
  var tab = false
  @ViewBuilder let send: () -> Send

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: z(10)) {
        ComposerHints(tab: tab)
        send()
      }
      send()
    }
  }
}
