import OmniKit
import SwiftUI

struct RolesScreen: View {
  let model: AppModel

  @State private var crew: Result<[CrewRole], OmniAPIError>?
  @State private var editing: RoleDraft?
  @State private var skills: [String] = []

  var body: some View {
    ScreenColumn {
      VStack(alignment: .leading, spacing: 0) {
        OmniPageHeader(
          title: "Roles",
          subtitle: "A role is a set of instructions, skills and the ticket stages it fits. A stage can have more than one role."
        ) {
          Button { editing = RoleDraft() } label: {
            HStack(spacing: z(6)) {
              OmniIcon(name: "plus", size: 13)
              Text("New role")
            }
          }
          .buttonStyle(.pill(.primary, height: 30))
          .accessibilityLabel("New role")
        }
        .padding(.top, z(40))
        .padding(.bottom, z(24))
        content
      }
    }
    .background(Tok.bg)
    .sheet(isPresented: Binding { editing != nil } set: { if !$0 { editing = nil } }) {
      if let draft = editing {
        RoleEditor(client: model.client, draft: draft, skillNames: skills, canDelete: canDelete(draft)) {
          editing = nil
          Task { await reload() }
        }
      }
    }
    .task(id: model.client.baseURL) {
      await load()
      await loadSkills()
    }
    .onChange(of: model.store.connection) { _, connection in
      if connection == .open { Task { await load() } }
    }
  }

  @ViewBuilder private var content: some View {
    switch crew {
    case nil:
      LoadingNote(label: "Loading roles")
    case .failure(let error):
      ErrorNote(text: error.message) { Task { await load() } }
    case .success(let list):
      VStack(alignment: .leading, spacing: z(24)) {
        VStack(spacing: z(8)) {
          ForEach(TicketStage.all) { stage in stageRow(stage, roles: Roles.at(stage.number, in: list)) }
        }
        let others = Roles.others(in: list)
        if !others.isEmpty {
          VStack(alignment: .leading, spacing: z(8)) {
            Text("Other roles").omniCaption().padding(.horizontal, z(12))
            FlowLayout(spacing: z(6)) {
              ForEach(others) { roleChip($0) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, z(16))
            .padding(.vertical, z(12))
            .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
          }
        }
      }
    }
  }

  private func stageRow(_ stage: TicketStage, roles: [CrewRole]) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: z(12)) {
      Text("\(stage.number)")
        .font(.omni(size: 12.5).monospacedDigit())
        .foregroundStyle(Tok.fg4)
        .frame(width: z(18), alignment: .trailing)
      Text(stage.name)
        .font(.omni(size: 13.5, weight: .medium))
        .foregroundStyle(Tok.fg)
        .lineLimit(1)
        .layoutPriority(1)
      Spacer(minLength: z(12))
      if roles.isEmpty {
        Text("No roles").font(.omni(size: 12.5)).foregroundStyle(Tok.fg4)
      } else {
        FlowLayout(spacing: z(6)) {
          ForEach(roles) { roleChip($0) }
        }
      }
    }
    .padding(.horizontal, z(16))
    .padding(.vertical, z(12))
    .background(Tok.surface, in: RoundedRectangle(cornerRadius: z(18), style: .continuous))
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Stage \(stage.number), \(stage.name)")
  }

  private func roleChip(_ role: CrewRole) -> some View {
    Button { editing = RoleDraft(role) } label: {
      Chip(text: role.name, tone: role.error == nil ? .plain : .needs)
    }
    .buttonStyle(.plain)
    .help(role.error ?? role.description)
    .accessibilityLabel("Edit \(role.name)")
  }

  private func canDelete(_ draft: RoleDraft) -> Bool {
    guard let id = draft.editing, case .success(let list) = crew, let role = list.first(where: { $0.id == id }) else { return false }
    return Roles.canDelete(role)
  }

  private func load() async {
    do {
      crew = .success(try await model.client.crew())
    } catch {
      if case .success = crew { return }
      crew = .failure(error)
    }
  }

  private func reload() async {
    await load()
    await model.store.reloadCrew()
  }

  private func loadSkills() async {
    guard let list = try? await model.client.commands(.newThread(harness: "claude-code", channel: SidebarSections.conductorID), wait: true) else { return }
    skills = Roles.skillNames(list.commands)
  }
}

private struct RoleEditor: View {
  let client: OmniClient
  @State var draft: RoleDraft
  let skillNames: [String]
  let canDelete: Bool
  let done: () -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var skillQuery = ""
  @State private var busy = false
  @State private var error: String?
  @State private var confirmingDelete = false
  @State private var idEdited = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(draft.isNew ? "New role" : "Edit role")
        .font(.omni(size: 17, weight: .medium))
        .foregroundStyle(Tok.fg)
        .padding([.horizontal, .top], z(24))
        .padding(.bottom, z(14))
      ScrollView {
        VStack(alignment: .leading, spacing: z(16)) {
          fields
          skillsField
          stagesField
        }
        .padding(.horizontal, z(24))
        .padding(.bottom, z(16))
      }
      VStack(alignment: .leading, spacing: z(12)) {
        if let error { ErrorNote(text: error) }
        footer
      }
      .padding(z(24))
    }
    .frame(width: z(620), height: z(680))
    .background(Tok.bg)
    .confirmationDialog("Delete \(draft.name)?", isPresented: $confirmingDelete) {
      Button("Delete", role: .destructive) { Task { await delete() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Omni removes the role file. Threads that ran as this role keep their history.")
    }
  }

  @ViewBuilder private var fields: some View {
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Name")
      TextField("", text: $draft.name, prompt: Text("Reviewer"))
        .textFieldStyle(.omni)
        .accessibilityLabel("Name")
        .onChange(of: draft.name) { _, name in
          if draft.isNew && !idEdited { draft.id = Roles.slug(name) }
        }
    }
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Id", hint: draft.isNew ? "Lowercase letters, digits and dashes. You cannot change it later." : nil)
      if draft.isNew {
        TextField("", text: Binding { draft.id } set: { draft.id = $0; idEdited = true }, prompt: Text("reviewer"))
          .textFieldStyle(.omniMono)
          .autocorrectionDisabled()
          .accessibilityLabel("Id")
      } else {
        Text(draft.id)
          .font(.omni(size: 13, design: .monospaced))
          .foregroundStyle(Tok.fg3)
          .textSelection(.enabled)
          .accessibilityLabel("Id: \(draft.id)")
      }
    }
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Description", hint: "One line on what the role does.")
      TextField("", text: $draft.description, prompt: Text("Reviews the diff before a manual test."))
        .textFieldStyle(.omni)
        .accessibilityLabel("Description")
    }
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Instructions", hint: "What the agent reads before it starts.")
      OmniTextEditor(text: $draft.charter, minHeight: 160)
        .accessibilityLabel("Instructions")
    }
  }

  private var skillsField: some View {
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Skills", hint: "Claude Code skills the role uses.")
      VStack(spacing: z(4)) {
        ForEach(draft.skills, id: \.self) { skill in
          HStack(spacing: z(10)) {
            Text(skill)
              .font(.omni(size: 12.5, design: .monospaced))
              .foregroundStyle(Tok.fg)
              .lineLimit(1)
              .truncationMode(.middle)
            Spacer(minLength: 0)
            Button("Remove \(skill)", systemImage: "trash") { draft.skills.removeAll { $0 == skill } }
              .labelStyle(.iconOnly)
              .buttonStyle(.icon(size: 26))
              .help("Remove")
          }
          .padding(.leading, z(12))
          .padding(.vertical, z(2))
          .hoverWash(14)
        }
      }
      HStack(spacing: z(8)) {
        TextField("", text: $skillQuery, prompt: Text("Search or type a skill name"))
          .textFieldStyle(.omniMono)
          .autocorrectionDisabled()
          .accessibilityLabel("Add skill")
          .onSubmit { add(skillQuery) }
        Button { add(skillQuery) } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: "plus", size: 13)
            Text("Add skill")
          }
        }
        .buttonStyle(.pill(.ghost, height: 34))
        .disabled(skillQuery.trimmingCharacters(in: .whitespaces).isEmpty)
        .accessibilityLabel("Add skill")
      }
      .padding(.top, z(8))
      let matches = skillQuery.isEmpty ? [] : Roles.matches(skillQuery, in: skillNames, excluding: draft.skills)
      if !matches.isEmpty {
        VStack(spacing: 0) {
          ForEach(matches, id: \.self) { name in
            Button { add(name) } label: {
              Text(name)
                .font(.omni(size: 12.5, design: .monospaced))
                .foregroundStyle(Tok.fg2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, z(12))
                .padding(.vertical, z(6))
                .hoverWash(12)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add \(name)")
          }
        }
        .padding(z(4))
        .overlay(RoundedRectangle(cornerRadius: z(14), style: .continuous).strokeBorder(Tok.line))
        .padding(.top, z(6))
      }
    }
  }

  private var stagesField: some View {
    VStack(alignment: .leading, spacing: 0) {
      FieldLabel(text: "Stages", hint: "Leave all off for a role outside the ticket flow.")
      LazyVGrid(columns: [GridItem(.flexible(), spacing: z(8)), GridItem(.flexible(), spacing: z(8))], alignment: .leading, spacing: z(8)) {
        ForEach(TicketStage.all) { stage in
          let on = draft.stages.contains(stage.number)
          HStack(spacing: z(10)) {
            Toggle(isOn: Binding { on } set: { if $0 { draft.stages.insert(stage.number) } else { draft.stages.remove(stage.number) } }) {
              EmptyView()
            }
            .toggleStyle(.omni)
            .accessibilityLabel("Stage \(stage.number), \(stage.name)")
            Text("\(stage.number)  \(stage.name)")
              .font(.omni(size: 13))
              .foregroundStyle(on ? Tok.fg : Tok.fg3)
              .lineLimit(1)
              .accessibilityHidden(true)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
  }

  private var footer: some View {
    HStack(spacing: z(10)) {
      if canDelete {
        Button(role: .destructive) { confirmingDelete = true } label: {
          HStack(spacing: z(6)) {
            OmniIcon(name: "trash", size: 13)
            Text("Delete")
          }
        }
        .buttonStyle(.pill(.ghost, height: 34))
        .disabled(busy)
        .accessibilityLabel("Delete role")
      }
      Spacer()
      Button("Cancel") { dismiss() }
        .buttonStyle(.pill(.ghost, height: 34))
        .keyboardShortcut(.cancelAction)
        .disabled(busy)
      Button { Task { await save() } } label: {
        HStack(spacing: z(8)) {
          if busy { Loader(size: 14) }
          Text(draft.isNew ? "Create role" : "Save")
        }
      }
      .buttonStyle(.pill(.primary, height: 34))
      .disabled(busy)
      .accessibilityLabel(draft.isNew ? "Create role" : "Save")
    }
  }

  private func add(_ name: String) {
    draft.addSkill(name)
    skillQuery = ""
  }

  private func save() async {
    if let problem = draft.problem {
      error = problem
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    do {
      if let id = draft.editing {
        _ = try await client.updateRole(id, draft.input)
      } else {
        _ = try await client.createRole(draft.input)
      }
      done()
    } catch {
      self.error = error.message
    }
  }

  private func delete() async {
    guard let id = draft.editing else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await client.deleteRole(id)
      done()
    } catch {
      self.error = error.message
    }
  }
}
