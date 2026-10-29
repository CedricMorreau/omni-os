import OmniKit
import SwiftUI

/// The `#/c/<id>` screen: the channel's header, its tabs and its threads, as Channel.tsx.
struct ChannelScreen: View {
  let model: AppModel
  let id: String
  let tab: ChannelTab
  let pr: Int?

  var body: some View {
    if let channel = model.store.channel(id) {
      ChannelView(model: model, channel: channel, tab: tab, pr: pr)
    } else if model.store.loadState == .loading {
      LoadingNote().padding(.horizontal, z(32)).frame(maxHeight: .infinity, alignment: .top)
    } else {
      MissingChannelView(model: model, id: id)
    }
  }
}

private struct ChannelView: View {
  let model: AppModel
  let channel: ChannelWithRunning
  let tab: ChannelTab
  let pr: Int?

  private var conductor: Bool { channel.id == SidebarSections.conductorID }

  var body: some View {
    ScreenColumn {
      VStack(alignment: .leading, spacing: 0) {
        header
          .padding(.top, z(40))
        links
        tabs.padding(.top, z(20))
        if tab == .threads && channel.kind != .system {
          quickLinks.padding(.top, z(16))
        }
        Group {
          switch tab {
          case .threads:
            ChannelThreads(model: model, channel: channel)
          case .settings:
            ChannelSettingsForm(model: model, existing: channel.channel)
              .frame(maxWidth: z(672), alignment: .leading)
              .id(channel.id)
          case .prs:
            // The main window shows the PRs tab through PullRequestsScreen, under ChannelTabsBar.
            EmptyView()
          }
        }
        .padding(.top, z(24))
      }
    }
  }

  private var header: some View {
    HStack(spacing: z(14)) {
      ChannelAvatar(name: channel.name, conductor: conductor, size: 44, icon: channel.icon)
      VStack(alignment: .leading, spacing: z(4)) {
        HStack(spacing: z(8)) {
          Text(kindLabel)
          if channel.running > 0 {
            HStack(spacing: z(6)) {
              GlyphView(glyph: .running, size: 7)
              Text("\(channel.running) running")
            }
            .foregroundStyle(Tok.live)
          }
        }
        .omniCaption()
        HStack(alignment: .firstTextBaseline, spacing: z(4)) {
          if !conductor {
            Text("#").foregroundStyle(Tok.fg4)
          }
          Text(channel.name).lineLimit(1).foregroundStyle(Tok.fg)
        }
        .font(.omni(size: 30, weight: .medium))
        .tracking(-0.3)
      }
      Spacer()
    }
  }

  private var kindLabel: String {
    switch channel.kind {
    case .client: "Client"
    case .internal: "Internal"
    case .personal: "Personal"
    case .system: "System"
    default: channel.kind.rawValue
    }
  }

  private var quickLinks: some View {
    HStack(spacing: z(6)) {
      ForEach(Array(channel.links.enumerated()), id: \.offset) { _, link in
        if let url = URL(string: link.url) {
          LinkPill(icon: "globe", text: link.label, url: url)
        }
      }
      QuickLinksButton(model: model, channelID: channel.id, links: channel.links)
      Spacer(minLength: 0)
    }
  }

  @ViewBuilder private var links: some View {
    let domain = channel.storeDomain.flatMap { $0.isEmpty ? nil : $0 }
    let repo = channel.githubRepo.flatMap { $0.isEmpty ? nil : $0 }
    let path = channel.repoPath.flatMap { $0.isEmpty ? nil : $0 }
    let note = conductor ? channel.notes.flatMap { $0.isEmpty ? nil : $0 } : nil
    if domain != nil || repo != nil || path != nil || note != nil {
      HStack(spacing: z(6)) {
        if let domain, let url = URL(string: "https://\(domain)/admin") {
          LinkPill(icon: "globe", text: domain, url: url)
        }
        if let repo, let url = URL(string: "https://github.com/\(repo)") {
          LinkPill(icon: "branch", text: repo, url: url)
        }
        if let path {
          Text(path)
            .font(.omni(size: 11, design: .monospaced))
            .foregroundStyle(Tok.fg4)
            .lineLimit(1)
            .truncationMode(.head)
            .padding(.horizontal, z(10))
            .frame(height: z(28))
            .overlay(Capsule().strokeBorder(Tok.line))
            .help(path)
        }
        if let note {
          Text(note)
            .font(.omni(size: 12.5))
            .foregroundStyle(Tok.fg3)
            .lineLimit(1)
            .padding(.horizontal, z(4))
        }
        Spacer(minLength: 0)
      }
      .padding(.top, z(16))
    }
  }

  private var tabs: some View {
    ChannelTabsPicker(model: model, channelID: channel.id, tab: tab, conductor: conductor)
  }
}

/// Threads, PRs and Settings, as Channel.tsx: PRs for every channel but the Conductor.
private struct ChannelTabsPicker: View {
  let model: AppModel
  let channelID: String
  let tab: ChannelTab
  let conductor: Bool

  var body: some View {
    let options: [(ChannelTab, String)] = conductor
      ? [(.threads, "Threads"), (.settings, "Settings")]
      : [(.threads, "Threads"), (.prs, "PRs"), (.settings, "Settings")]
    SegmentedPill(selection: Binding(get: { tab }, set: { model.route = .channel(id: channelID, tab: $0) }), options: options)
      .fixedSize()
      .accessibilityElement(children: .contain)
      .accessibilityLabel("Channel tabs")
  }
}

/// The channel's name and tabs above the PRs screens, so the other tabs stay one click away.
struct ChannelTabsBar: View {
  let model: AppModel
  let channelID: String

  var body: some View {
    if let channel = model.store.channel(channelID) {
      let conductor = channel.id == SidebarSections.conductorID
      HStack(spacing: z(10)) {
        ChannelAvatar(name: channel.name, conductor: conductor, size: 28, icon: channel.icon)
        HStack(alignment: .firstTextBaseline, spacing: z(2)) {
          if !conductor { Text("#").foregroundStyle(Tok.fg4) }
          Text(channel.name).foregroundStyle(Tok.fg)
        }
        .font(.omni(size: 15, weight: .medium))
        .lineLimit(1)
        Spacer()
        ChannelTabsPicker(model: model, channelID: channel.id, tab: .prs, conductor: conductor)
      }
      .padding(.horizontal, z(24))
      .padding(.top, z(12))
    }
  }
}

/// A store or repo link in the header: a surface pill that deepens on hover.
private struct LinkPill: View {
  let icon: String
  let text: String
  let url: URL
  @State private var hovering = false

  var body: some View {
    Link(destination: url) {
      HStack(spacing: z(6)) {
        OmniIcon(name: icon, size: 13).foregroundStyle(Tok.fg3)
        Text(text).lineLimit(1).foregroundStyle(Tok.fg2)
      }
      .font(.omni(size: 12))
      .padding(.horizontal, z(10))
      .frame(height: z(28))
      .background(hovering ? Tok.surface2 : Tok.surface, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
  }
}

/// The channel's threads, newest first: the fetched list with the feed's changes laid over it.
private struct ChannelThreads: View {
  let model: AppModel
  let channel: ChannelWithRunning
  @State private var loaded: [OmniThread]?
  @State private var archived: [OmniThread] = []
  @State private var prs: [String: BranchPRMark] = [:]
  @State private var error: String?
  @State private var tickets: [Ticket] = []

  private struct TicketsWatch: Hashable {
    let channel: String
    let threads: [String]
    let epoch: Int
  }

  var body: some View {
    let threads = ThreadListing.merging(loaded: loaded ?? [], live: model.store.recent, channel: channel.id)
    let nestedChildren = Set(channel.handoffs.flatMap { $0.children.map(\.id) })
    let client = channel.kind == .client
    let shownTickets = client ? tickets : []
    let visibleThreads = TicketBoard.others(threads.filter { !nestedChildren.contains($0.id) }, tickets: shownTickets)
    VStack(alignment: .leading, spacing: z(32)) {
      NewThreadComposerView(model: model, channelID: channel.id)
        .id(channel.id)
      NeedsYouSection(model: model, inbox: model.store.needsYou?.inChannel(channel.id), quiet: true)
      let ticketed = loaded != nil && !shownTickets.isEmpty
      if ticketed {
        TicketStageList(model: model, sections: TicketBoard.sections(shownTickets))
      }
      if let error, loaded == nil {
        ErrorNote(text: error) { Task { await load() } }
      } else if loaded == nil {
        LoadingNote()
      } else if ticketed, visibleThreads.isEmpty, channel.folders.isEmpty {
        EmptyView()
      } else {
        VStack(alignment: .leading, spacing: z(8)) {
          if ticketed {
            Text("Other threads").omniCaption().padding(.horizontal, z(10))
          }
          if !channel.folders.isEmpty {
            ThreadFolderList(model: model, channel: channel, threads: visibleThreads, prs: prs, handoffs: channel.handoffs)
          } else if visibleThreads.isEmpty {
            EmptyNote(symbol: "message", title: "No threads in this channel yet", message: "Start one above. Crew threads delegated by the Conductor land here too.")
          } else {
            ThreadDayList(model: model, threads: visibleThreads, prs: prs, handoffs: channel.handoffs)
          }
        }
      }
      if loaded != nil, !archived.isEmpty {
        ArchivedThreadsSection(model: model, threads: archived) { await load() }
      }
    }
    .task(id: "\(channel.id)/\(ObjectIdentifier(model.store).hashValue)") {
      loaded = nil
      archived = []
      prs = [:]
      await load()
    }
    // An archive or a restore moves a thread between the two lists; refetch both, keeping what shows meanwhile.
    .onChange(of: model.store.archiveEpoch) { Task { await load() } }
    .task(id: TicketsWatch(
      channel: client ? channel.id : "", threads: threads.map { "\($0.id)|\($0.status)|\($0.updatedAt.timeIntervalSince1970)" },
      epoch: model.store.archiveEpoch)
    ) {
      guard client else {
        tickets = []
        return
      }
      if let list = try? await model.client.tickets(channel: channel.id), !Task.isCancelled { tickets = list }
    }
    // A merge shows up within a minute, as on the web.
    .task(id: channel.id) {
      while !Task.isCancelled {
        if let marks = try? await model.client.threadPullRequests(in: channel.id) { prs = marks }
        try? await Task.sleep(for: .seconds(60))
      }
    }
  }

  private func load() async {
    error = nil
    // The archived list is extra: when it fails, the channel still shows its threads.
    let id = channel.id
    let gone = Task { try? await model.client.channelThreads(id, archived: true) }
    do {
      loaded = try await model.client.channelThreads(id)
    } catch {
      if error != .cancelled { self.error = error.message }
    }
    if let list = await gone.value, !Task.isCancelled { archived = list }
  }
}

private struct TicketStageList: View {
  let model: AppModel
  let sections: [TicketBoard.Section]

  var body: some View {
    LazyVStack(alignment: .leading, spacing: z(12)) {
      ForEach(sections) { section in
        VStack(alignment: .leading, spacing: 0) {
          HStack(spacing: z(6)) {
            Circle().fill(Tok.phase(section.phase)).frame(width: z(7), height: z(7))
            Text(section.title)
              .foregroundStyle(Tok.phase(section.phase))
            Text("\(section.tickets.count)")
              .foregroundStyle(Tok.fg4)
          }
          .omniCaption()
          .padding(.horizontal, z(10))
          .padding(.vertical, z(6))
          .accessibilityElement(children: .combine)
          .accessibilityLabel("\(section.title), \(Format.plural(section.tickets.count, "ticket"))")
          ForEach(section.tickets) { ticket in
            TicketListRow(model: model, ticket: ticket)
              .openInNewWindow(ticket.threadID, model: model, title: ticket.title)
          }
        }
      }
    }
  }
}

private struct TicketListRow: View {
  let model: AppModel
  let ticket: Ticket
  @State private var hovering = false

  var body: some View {
    Button {
      model.route = .thread(id: ticket.threadID)
    } label: {
      HStack(spacing: z(8)) {
        Text(ticket.title.isEmpty ? "Untitled" : ticket.title)
          .font(.omni(size: 14))
          .foregroundStyle(Tok.fg)
          .lineLimit(1)
          .truncationMode(.tail)
        if !ticket.ref.isEmpty { Chip(text: ticket.ref, tone: .outline) }
        StagePill(text: ticket.stageLabel, phase: ticket.phase)
        Spacer(minLength: z(8))
        if let updated = ticket.updated {
          TimelineView(.everyMinute) { _ in
            Text(Format.relTime(updated))
              .font(.omni(size: 11))
              .monospacedDigit()
              .foregroundStyle(Tok.fg4)
          }
        }
      }
      .padding(.horizontal, z(10))
      .padding(.vertical, z(10))
      .contentShape(Rectangle())
      .background(hovering ? Tok.surface : .clear, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(ticket.title.isEmpty ? "Untitled" : ticket.title), \(ticket.ref), \(ticket.stageLabel)")
  }
}

/// The channel's archived threads under its list, as ArchivedThreads in ThreadList.tsx: a closed "Archived" header with
/// the count, opening to the threads with Restore on each.
private struct ArchivedThreadsSection: View {
  let model: AppModel
  let threads: [OmniThread]
  let reload: () async -> Void
  @State private var open = false
  @State private var hover = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Button {
        withAnimation(Motion.settle) { open.toggle() }
      } label: {
        HStack(spacing: z(6)) {
          OmniIcon(name: open ? "chevronDown" : "chevronRight", size: 12)
            .foregroundStyle(Tok.fg4)
            .frame(width: z(12))
          OmniIcon(name: "archive", size: 13)
            .foregroundStyle(Tok.fg3)
          Text("Archived")
          Text("\(threads.count)")
            .foregroundStyle(Tok.fg4)
          Spacer(minLength: 0)
        }
        .omniCaption()
        .padding(.horizontal, z(10))
        .padding(.vertical, z(6))
        .contentShape(Capsule())
        .background(hover ? Tok.surface : .clear, in: Capsule())
      }
      .buttonStyle(.plain)
      .onHover { hover = $0 }
      .accessibilityLabel("Archived, \(Format.plural(threads.count, "thread"))")
      .accessibilityValue(open ? "Expanded" : "Collapsed")
      #if DEBUG
      .onAppear { QAProbe.expand = { open = true } }
      .onDisappear { QAProbe.expand = nil }
      #endif
      if open {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(threads) { t in
            ArchivedThreadRow(model: model, thread: t, reload: reload)
          }
        }
      }
    }
  }
}

private struct ArchivedThreadRow: View {
  let model: AppModel
  let thread: OmniThread
  let reload: () async -> Void
  @State private var busy = false
  @State private var failed = false

  var body: some View {
    HStack(spacing: z(4)) {
      ThreadListRow(model: model, thread: thread)
        .opacity(0.8)
        .openInNewWindow(thread.id, model: model, title: thread.title, archived: true)
      VStack(alignment: .trailing, spacing: z(2)) {
        Button {
          Task { await restore() }
        } label: {
          HStack(spacing: z(6)) {
            if busy { Loader(size: 12) } else { OmniIcon(name: "archive", size: 14) }
            Text("Restore")
          }
        }
        .buttonStyle(.pill(.secondary, height: 28))
        .disabled(busy)
        .help("Put it back in the channel's thread list")
        .accessibilityLabel("Restore \(thread.title.isEmpty ? "Untitled" : thread.title)")
        if failed {
          Text("Could not restore").font(.omni(size: 11)).foregroundStyle(Tok.fg3)
        }
      }
      .padding(.trailing, z(4))
    }
  }

  private func restore() async {
    busy = true
    failed = false
    defer { busy = false }
    if await model.setThreadArchived(thread.id, false) {
      await reload()
    } else {
      failed = true
    }
  }
}

private struct QuickLinksButton: View {
  let model: AppModel
  let channelID: String
  let links: [ChannelLink]
  @State private var editing = false
  @State private var hovering = false

  var body: some View {
    Button { editing = true } label: {
      HStack(spacing: z(4)) {
        OmniIcon(name: links.isEmpty ? "plus" : "pencil", size: 12).foregroundStyle(Tok.fg3)
        if links.isEmpty { Text("Add link").foregroundStyle(Tok.fg3) }
      }
      .font(.omni(size: 12))
      .padding(.horizontal, z(10))
      .frame(minWidth: z(28), minHeight: z(28))
      .background(hovering ? Tok.surface2 : Tok.surface, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .help(links.isEmpty ? "Add a quick link" : "Edit quick links")
    .accessibilityLabel(links.isEmpty ? "Add a quick link" : "Edit quick links")
    .popover(isPresented: $editing, arrowEdge: .bottom) {
      QuickLinksEditor(model: model, channelID: channelID, start: links) { editing = false }
    }
  }
}

private struct QuickLinksEditor: View {
  let model: AppModel
  let channelID: String
  let done: () -> Void
  @State private var rows: [ChannelLink]
  @State private var saving = false
  @State private var error: String?

  init(model: AppModel, channelID: String, start: [ChannelLink], done: @escaping () -> Void) {
    self.model = model
    self.channelID = channelID
    self.done = done
    _rows = State(initialValue: start.isEmpty ? [ChannelLink(label: "", url: "")] : start)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: z(10)) {
      Text("Quick links").font(.omni(size: 14, weight: .medium)).foregroundStyle(Tok.fg)
      ForEach(rows.indices, id: \.self) { i in
        HStack(spacing: z(6)) {
          TextField("Name", text: $rows[i].label, prompt: Text("Productive"))
            .textFieldStyle(.omni)
            .frame(width: z(140))
            .accessibilityLabel("Link \(i + 1) name")
          TextField("Address", text: $rows[i].url, prompt: Text("https://"))
            .textFieldStyle(.omniMono)
            .frame(width: z(300))
            .accessibilityLabel("Link \(i + 1) address")
          Button { rows.remove(at: i) } label: { OmniIcon(name: "trash", size: 13).foregroundStyle(Tok.fg3) }
            .buttonStyle(.plain)
            .help("Remove this link")
            .accessibilityLabel("Remove link \(i + 1)")
        }
      }
      Button { rows.append(ChannelLink(label: "", url: "")) } label: {
        HStack(spacing: z(6)) {
          OmniIcon(name: "plus", size: 12)
          Text("Add link")
        }
      }
      .buttonStyle(.pill(.ghost, height: 30))
      .disabled(rows.count >= 20)
      if let error { ErrorNote(text: error) }
      HStack(spacing: z(8)) {
        Spacer(minLength: 0)
        Button("Cancel", action: done).buttonStyle(.pill(.ghost, height: 32))
        Button(saving ? "Saving" : "Save") { Task { await save() } }
          .buttonStyle(.pill(.primary, height: 32))
          .disabled(saving)
          .keyboardShortcut(.defaultAction)
      }
    }
    .padding(z(16))
    .frame(width: z(520))
  }

  private func save() async {
    let kept = rows
      .map { ChannelLink(label: $0.label.trimmingCharacters(in: .whitespaces), url: $0.url.trimmingCharacters(in: .whitespaces)) }
      .filter { !($0.label.isEmpty && $0.url.isEmpty) }
    saving = true
    defer { saving = false }
    do {
      _ = try await model.client.setChannelLinks(channelID, kept)
      await model.store.reloadChannels()
      done()
    } catch {
      self.error = error.message
    }
  }
}
