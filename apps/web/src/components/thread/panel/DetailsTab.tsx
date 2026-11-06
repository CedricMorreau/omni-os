import { useEffect, useState, type ReactNode } from 'react';
import { type ThreadLinks } from '@omni/shared/continue-flow.ts';
import type { BackgroundTask, Channel, Thread } from '../../../api.ts';
import { HarnessMark } from '../../brand.tsx';
import { Button, CopyButton, ErrorNote, Modal, StatusDot } from '../../ui.tsx';
import { api, ApiError } from '../../../api.ts';
import { MCP_ACTION_LABEL, mcpActions, mcpFromInit, mcpStatusText, type McpAction, type McpServer } from '../../../mcp-servers.ts';
import { duration, fullDate, plural } from '../../../format.ts';
import { href } from '../../../router.ts';
import { cloudAgentUrl } from '@omni/shared/cloud-agent.ts';
import type { PanelTab } from '../../../pages/useThreadSession.ts';
import type { PRNext, PRStep } from '@omni/shared/thread-glance.ts';
import { AgentsSection } from './AgentsSection.tsx';
import { CrewGlance, GlanceCard, type BranchChanges } from './GlanceCard.tsx';
import type { ThreadPRs } from './PRsTab.tsx';

export interface InitP {
  model?: string;
  cwd?: string;
  tools?: number;
  mcp?: string[];
}
export interface ResultP {
  duration_ms?: number;
  turns?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
}

const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

type McpReply = { servers: McpServer[]; auth_url: string | null };

/** Every MCP server as a chip, green when connected and grey otherwise. A click shows its status in words and the /mcp actions. */
function McpList({ threadId, servers }: { threadId: string; servers: string[] }) {
  const snapshot = servers.join('\n');
  const [rows, setRows] = useState<McpServer[]>(() => mcpFromInit(servers));
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<McpAction | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [idle, setIdle] = useState<string | null>(null);

  useEffect(() => {
    setRows(mcpFromInit(snapshot.split('\n')));
    let alive = true;
    api
      .post<McpReply>(`/threads/${threadId}/mcp`, { action: 'status' })
      .then((r) => alive && (setRows(r.servers), setIdle(null)))
      .catch((e) => alive && e instanceof ApiError && e.status === 409 && setIdle(e.message));
    return () => {
      alive = false;
    };
  }, [threadId, snapshot]);

  const run = async (server: string, action: McpAction) => {
    setBusy(action);
    setProblem(null);
    try {
      const r = await api.post<McpReply>(`/threads/${threadId}/mcp`, { action, server });
      setRows(r.servers);
      if (r.auth_url) window.open(r.auth_url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const ok = rows.filter((r) => r.status === 'connected');
  const rest = rows.filter((r) => r.status !== 'connected');
  const open = rows.find((r) => r.name === picked) ?? null;
  const label = (name: string) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(name) ? `${name.slice(0, 8)}…` : name);
  return (
    <div>
      <span className="text-fg-2">
        {ok.length} connected
        {rest.length > 0 && <span className="text-fg-3"> · {rest.length} not connected</span>}
      </span>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {[...ok, ...rest].map((r) => (
          <button
            key={r.name}
            type="button"
            title={`${r.name}: ${mcpStatusText(r)}`}
            onClick={() => (setPicked(r.name), setProblem(null))}
            className="press inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 text-[11px] leading-none font-medium text-fg-2 hover:text-fg"
          >
            <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.status === 'connected' ? 'bg-done' : 'bg-fg-4'}`} />
            <span className="truncate">{label(r.name)}</span>
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setPicked(null)} title={open?.name}>
        {open && (
          <div className="flex flex-col gap-3 px-6 pt-1 pb-5 text-[13.5px]">
            <p className="flex items-center gap-2 text-fg-2">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${open.status === 'connected' ? 'bg-done' : 'bg-fg-4'}`} />
              {mcpStatusText(open)}
            </p>
            {idle && <p className="text-fg-3">{idle}</p>}
            <div className="flex flex-wrap gap-2">
              {(idle ? [] : mcpActions(open)).map((a) => (
                <Button key={a} size="sm" variant="secondary" disabled={!!busy} onClick={() => void run(open.name, a)}>
                  {busy === a ? `${MCP_ACTION_LABEL[a]}…` : MCP_ACTION_LABEL[a]}
                </Button>
              ))}
            </div>
            {problem && <ErrorNote>{problem}</ErrorNote>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 px-3.5 py-2 text-[12.5px]">
      <dt className="pt-px text-fg-3">{k}</dt>
      <dd className="min-w-0 text-fg [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export function DetailsTab({
  thread,
  channel,
  parent,
  children,
  init,
  lastResult,
  warm,
  links,
  agents,
  onJump,
  prs,
  changes,
  next,
  step = null,
  onAsk = () => {},
  onTab = () => {},
}: {
  thread: Thread;
  channel: Channel | undefined;
  parent: Thread | null;
  children: Thread[];
  init: InitP | null;
  lastResult: ResultP | null;
  warm: boolean | undefined;
  links: ThreadLinks;
  /** Its running sub-agents (subagents.ts), listed with its other agents near the top. */
  agents: BackgroundTask[];
  onJump: (eventId: number) => void;
  /** The branch card on top: its PRs, changes, the step its PR calls for, and how to take it. */
  prs?: ThreadPRs;
  changes?: BranchChanges;
  next?: PRNext;
  /** The step the agent is working on, so its button shows it. */
  step?: PRStep | null;
  onAsk?: (prompt: string) => void;
  onTab?: (tab: PanelTab) => void;
}) {
  const cwd = init?.cwd || thread.cwd;
  const cloud = thread.harness === 'cursor-cloud';
  const remote = thread.harness === 'hermes' || cloud;
  const agentUrl = cloud ? cloudAgentUrl(thread.session_id) : null;
  const resumeCmd: Record<string, string> = {
    'claude-code': `claude --resume ${thread.session_id}`,
    codex: `codex resume ${thread.session_id}`,
    cursor: `cursor-agent --resume ${thread.session_id}`,
  };
  const resume = remote ? '' : `cd ${shellQuote(cwd)} && ${resumeCmd[thread.harness] ?? resumeCmd['claude-code']}`;
  return (
    <div className="scroll-thin flex h-full flex-col gap-3 overflow-y-auto px-2.5 pb-3 [&>*]:shrink-0">
      <GlanceCard thread={thread} prs={prs} changes={changes ?? null} next={next ?? null} step={step} onAsk={onAsk} onTab={onTab} />
      {prs && <CrewGlance crew={prs.crew} onTab={onTab} />}
      <AgentsSection parent={parent} links={links} children={children} agents={agents} onJump={onJump} />
      <dl className="divide-y divide-line rounded-[20px] bg-bg py-1">
        <Row k="Channel">
          <a href={href.channel(thread.channel_id)} className="font-medium hover:underline">
            #{channel?.name ?? thread.channel_id}
          </a>
        </Row>
        <Row k="Role">{thread.role ?? <span className="text-fg-3">none</span>}</Row>
        <Row k="Harness">
          <HarnessMark harness={thread.harness} withLabel />
        </Row>
        <Row k="Model">
          {thread.model || init?.model || <span className="text-fg-3">default</span>}
          {thread.model && init?.model && init.model !== thread.model && <span className="ml-1 text-fg-3">({init.model})</span>}
        </Row>
        <Row k="Effort">{thread.effort || <span className="text-fg-3">default</span>}</Row>
        {thread.auto_reason && <Row k="Auto">{thread.auto_reason}</Row>}
        <Row k="Source">
          {thread.source}
          {thread.automation && <span className="text-fg-3"> · {thread.automation}</span>}
        </Row>
        <Row k="Working dir">
          {remote ? (
            <span className="text-fg-3">{cloud ? 'Cursor cloud agent, not an Omni worktree' : 'Hermes server, not an Omni worktree'}</span>
          ) : (
            <span className="font-mono text-[12px]">{cwd}</span>
          )}
        </Row>
        <Row k="Session">
          <span className="font-mono text-[12px]">{thread.session_id}</span>
          {warm !== undefined && (
            <div className="mt-0.5 flex items-center gap-1.5 text-fg-3">
              <StatusDot status={warm ? 'done' : 'imported'} size={6} />
              {warm ? 'Live, the next message starts instantly' : 'Not running, the next message starts a new process'}
            </div>
          )}
        </Row>
        {thread.task_id && (
          <Row k="Task">
            <span className="font-mono text-[12px]">{thread.task_id}</span>
          </Row>
        )}
        {init?.mcp && init.mcp.length > 0 && (
          <Row k="MCP">
            <McpList threadId={thread.id} servers={init.mcp} />
          </Row>
        )}
        <Row k="Created">{fullDate(thread.created_at)}</Row>
        <Row k="Updated">{fullDate(thread.updated_at)}</Row>
        {lastResult?.duration_ms != null && (
          <Row k="Last run">
            {duration(lastResult.duration_ms)}
            {lastResult.turns ? <span className="text-fg-3"> · {plural(lastResult.turns, 'turn')}</span> : null}
            {lastResult.model ? <span className="text-fg-3"> · {lastResult.model}</span> : null}
            {lastResult.input_tokens != null ? (
              <span className="text-fg-3">
                {' '}
                · {lastResult.input_tokens} in / {lastResult.output_tokens ?? 0} out
              </span>
            ) : null}
          </Row>
        )}
      </dl>

      {remote ? (
        <div className="rounded-[20px] bg-bg p-3.5">
          <div className="caption mb-2">{cloud ? 'Cursor cloud agent' : 'Remote session'}</div>
          {cloud ? (
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              This thread runs on Cursor's Linux cloud, on its own clone of the channel repo. It pushes a branch and Cursor opens the PR. Another message here
              goes to the agent as a follow-up.{' '}
              {agentUrl ? (
                <a href={agentUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-fg underline-offset-2 hover:underline">
                  Open it in Cursor
                </a>
              ) : (
                'It has not started yet.'
              )}
            </p>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-fg-2">
              This thread runs on the Hermes server. Another message here resumes <span className="font-mono">{thread.session_id}</span>.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-[20px] bg-bg p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="caption">Resume in terminal</span>
            <CopyButton text={resume} />
          </div>
          <code className="block rounded-xl bg-surface px-3 py-2.5 font-mono text-[11.5px] break-all text-fg-2">{resume}</code>
        </div>
      )}
    </div>
  );
}
