import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, errorText, useApi, type CommandList, type CrewRole } from '../api.ts';
import { Button, ErrorNote, IconButton, InlineConfirm, Label, PageHeader } from '../components/ui.tsx';
import { addSkill, canDeleteRole, ROLE_ID, roleSlug, rolesByStage, STAGES, toggleStage } from '../roles.ts';
import { useApp } from '../store.tsx';

const NEW = '';

function RoleChip({ role, onOpen }: { role: CrewRole; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={role.description || undefined}
      className="press inline-flex h-7 max-w-full items-center truncate rounded-full bg-bg px-3 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_var(--line)] hover:bg-surface-2"
    >
      {role.name}
    </button>
  );
}

export function RolesPage() {
  const { crew, reloadCrew, channels } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const { stages, other } = useMemo(() => rolesByStage(crew), [crew]);
  const scroller = useRef<HTMLDivElement>(null);
  const channelId = channels[0]?.id;
  const commands = useApi<CommandList>(editing !== null && channelId ? `/commands?harness=claude-code&channel=${encodeURIComponent(channelId)}&wait=1` : null);
  const skillNames = useMemo(() => (commands.data?.commands ?? []).map((c) => c.name), [commands.data]);

  useEffect(() => {
    reloadCrew();
  }, [reloadCrew]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [editing]);

  const role = editing ? crew.find((r) => r.id === editing) : undefined;
  const done = () => {
    reloadCrew();
    setEditing(null);
  };

  return (
    <div ref={scroller} className="scroll-thin h-full overflow-y-auto">
      <PageHeader
        width="max-w-3xl"
        title="Roles"
        subtitle="Each role is a set of instructions and skills for one or more ticket stages."
        actions={
          editing === null && (
            <Button variant="primary" icon="plus" onClick={() => setEditing(NEW)}>
              New role
            </Button>
          )
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 px-4 pt-2 pb-16 md:px-8">
        {editing !== null ? (
          <RoleForm key={editing} role={role} skillNames={skillNames} onDone={done} onCancel={() => setEditing(null)} />
        ) : (
          <>
            <ol className="space-y-2" aria-label="Stages">
              {stages.map((s) => (
                <li key={s.stage} className="flex items-start gap-3 rounded-[18px] bg-surface px-4 py-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg text-[12px] font-medium text-fg-2 tabular-nums">{s.stage}</span>
                  <div className="min-w-0 flex-1">
                    <div className="pt-1 text-[13.5px] font-medium">{s.name}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.roles.length ? s.roles.map((r) => <RoleChip key={r.id} role={r} onOpen={() => setEditing(r.id)} />) : <span className="text-[12.5px] text-fg-4">No roles</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {other.length > 0 && (
              <div className="space-y-2">
                <div className="caption px-1">Other roles</div>
                <ul className="space-y-2">
                  {other.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setEditing(r.id)} className="press flex w-full flex-col gap-0.5 rounded-[18px] bg-surface px-4 py-3 text-left">
                        <span className="text-[13.5px] font-medium">{r.name}</span>
                        {r.description && <span className="text-[12.5px] leading-snug text-fg-3">{r.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RoleForm({ role, skillNames, onDone, onCancel }: { role?: CrewRole; skillNames: string[]; onDone: () => void; onCancel: () => void }) {
  const creating = !role;
  const [name, setName] = useState(role?.name ?? '');
  const [id, setId] = useState<string | null>(role?.id ?? null);
  const [description, setDescription] = useState(role?.description ?? '');
  const [charter, setCharter] = useState(role?.charter ?? '');
  const [skills, setSkills] = useState(role?.skills ?? []);
  const [stages, setStages] = useState(role?.stages ?? []);
  const [skillDraft, setSkillDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleId = id ?? roleSlug(name);
  const suggestions = skillNames.filter((s) => !skills.includes(s));

  const takeSkill = () => {
    setSkills((list) => addSkill(list, skillDraft));
    setSkillDraft('');
  };

  const onSkillKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    takeSkill();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the role a name.');
    if (creating && !ROLE_ID.test(roleId)) return setError('Use lowercase letters, digits and dashes for the id.');
    const body = { name: name.trim(), description: description.trim(), ...(role?.model && { model: role.model }), skills: addSkill(skills, skillDraft), stages, charter };
    setBusy(true);
    setError(null);
    try {
      if (creating) await api.post<CrewRole>('/crew', { id: roleId, ...body });
      else await api.put<CrewRole>(`/crew/${encodeURIComponent(role.id)}`, body);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!role) return;
    setError(null);
    try {
      await api.del(`/crew/${encodeURIComponent(role.id)}`);
      onDone();
    } catch (err) {
      setError(errorText(err));
      throw err;
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[24px] p-4 shadow-[inset_0_0_0_1px_var(--line)] md:p-5" autoComplete="off">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px]">{creating ? 'New role' : role.name}</h2>
        {role?.source === 'shipped' && <span className="text-[12px] text-fg-3">Omni ships this role. Saving makes your own copy.</span>}
      </div>
      {role?.error && <ErrorNote>{role.error}</ErrorNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="role-name">Name</Label>
          <input id="role-name" className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Reviewer" autoFocus={creating} />
        </div>
        <div>
          <Label htmlFor="role-id" hint={creating ? 'Lowercase letters, digits and dashes. You cannot change it later.' : undefined}>
            Id
          </Label>
          <input
            id="role-id"
            className="field font-mono !text-[13px]"
            value={roleId}
            maxLength={40}
            readOnly={!creating}
            onChange={(e) => setId(e.target.value.toLowerCase())}
            placeholder="reviewer"
            spellCheck={false}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="role-description">Description</Label>
        <input id="role-description" className="field" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} placeholder="Reviews the diff before the client sees it" />
      </div>
      <div>
        <Label htmlFor="role-charter" hint="What the role does and how. The agent reads this first.">
          Instructions
        </Label>
        <textarea
          id="role-charter"
          className="field min-h-[180px] resize-y font-mono !text-[13px] leading-relaxed"
          value={charter}
          onChange={(e) => setCharter(e.target.value)}
          placeholder="You review the change for bugs and over-engineering."
          spellCheck={false}
        />
      </div>
      <div>
        <Label htmlFor="role-skill" hint="Claude Code skills and commands this role uses. Pick one from the list or type any name.">
          Skills
        </Label>
        {skills.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Skills">
            {skills.map((s) => (
              <li key={s} className="inline-flex h-7 max-w-full items-center gap-0.5 rounded-full bg-surface-2 pr-0.5 pl-3 font-mono text-[12px] text-fg-2">
                <span className="truncate">{s}</span>
                <IconButton icon="x" size={12} label={`Remove ${s}`} className="!h-6 !w-6" onClick={() => setSkills((list) => list.filter((x) => x !== s))} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            id="role-skill"
            className="field min-w-0 flex-1 font-mono !text-[13px]"
            list="role-skill-options"
            value={skillDraft}
            onChange={(e) => setSkillDraft(e.target.value)}
            onKeyDown={onSkillKey}
            placeholder="code-review"
            spellCheck={false}
            autoCapitalize="off"
          />
          <Button icon="plus" onClick={takeSkill} disabled={!skillDraft.trim()}>
            Add skill
          </Button>
        </div>
        <datalist id="role-skill-options">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[12.5px] font-medium text-fg-2">Stages</legend>
        <div className="flex flex-wrap gap-1.5">
          {STAGES.map((label, i) => {
            const on = stages.includes(i + 1);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => setStages((list) => toggleStage(list, i + 1))}
                className={`press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium ${on ? 'bg-fg text-on-ink' : 'bg-surface-2 text-fg-2 hover:bg-surface-3'}`}
              >
                <span className="tabular-nums opacity-60">{i + 1}</span>
                {label}
              </button>
            );
          })}
        </div>
        {stages.length === 0 && <p className="mt-1.5 text-[12px] text-fg-3">With no stage, the role shows under Other roles.</p>}
      </fieldset>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" variant="primary" busy={busy}>
          {creating ? 'Create role' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {role && canDeleteRole(role) && (
          <span className="ml-auto">
            <InlineConfirm label="Delete" icon="trash" confirmLabel="Delete role" busyLabel="Deleting" onConfirm={remove} />
          </span>
        )}
      </div>
    </form>
  );
}
