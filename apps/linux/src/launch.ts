// How the Linux app decides to start or attach, and the environment of the server it starts.
// The rules match the Mac app (apps/mac/OmniKit/Sources/OmniKit/ServerLaunch.swift and ServerToken.swift):
// Node 24 or later, this checkout, and a proof that the process on the port holds this install's token.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

export const MIN_NODE = 24;

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(text: string): NodeVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion(version: NodeVersion): string {
  return `v${version.major}.${version.minor}.${version.patch}`;
}

function compareVersions(a: NodeVersion, b: NodeVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Override, then installed Nodes new enough, highest first, then PATH, then the older installs. */
export function orderedNodeBins(input: {
  override: string | null;
  installed: { path: string; version: NodeVersion }[];
  pathBins: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  if (input.override) add(input.override);
  const ranked = [...input.installed].sort((a, b) => compareVersions(b.version, a.version));
  for (const bin of ranked) if (bin.version.major >= MIN_NODE) add(bin.path);
  for (const bin of input.pathBins) add(bin);
  for (const bin of ranked) if (bin.version.major < MIN_NODE) add(bin.path);
  return out;
}

export async function pickNode(
  bins: string[],
  versionOf: (path: string) => Promise<NodeVersion | null>,
): Promise<{ ok: true; path: string; version: NodeVersion } | { ok: false; message: string }> {
  let older: { path: string; version: NodeVersion } | null = null;
  for (const path of bins) {
    const version = await versionOf(path);
    if (!version) continue;
    if (version.major >= MIN_NODE) return { ok: true, path, version };
    if (!older || compareVersions(version, older.version) > 0) older = { path, version };
  }
  if (older) return { ok: false, message: `Omni needs Node 24 or later, and ${older.path} is ${formatVersion(older.version)}.` };
  return { ok: false, message: 'Node 24 or later was not found. Install it, then start again.' };
}

/** PATH from a login shell, between markers, so a shell that echoes the command cannot fake it. */
export function extractPath(output: string, id: string): string | null {
  const start = output.indexOf(`OMNISTART${id}\n`);
  if (start < 0) return null;
  const from = start + `OMNISTART${id}\n`.length;
  const end = output.indexOf(`\nOMNIEND${id}`, from);
  if (end < 0) return null;
  const path = output.slice(from, end);
  if (!path || path.includes('\n')) return null;
  return path;
}

export function fallbackPath(home: string): string {
  return [`${home}/.local/share/mise/shims`, `${home}/.local/bin`, '/usr/local/bin', '/usr/bin', '/bin'].join(':');
}

const PASSTHROUGH = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'XDG_CURRENT_DESKTOP', 'XDG_SESSION_TYPE', 'XDG_DATA_DIRS', 'XDG_CONFIG_DIRS',
] as const;

/** Billing keys never go to the server. The server runs harnesses on the plans you are signed in to. */
export function blockedEnvKey(key: string): boolean {
  return key.startsWith('ANTHROPIC_') || key.endsWith('_API_KEY') || key.endsWith('_AUTH_TOKEN') || key === 'OPENAI_BASE_URL';
}

export function nodeDirFirst(nodeBin: string, loginPath: string): string {
  const dir = nodeBin.slice(0, nodeBin.lastIndexOf('/'));
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const entry of [dir, ...loginPath.split(':')]) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    dirs.push(entry);
  }
  return dirs.join(':');
}

/** The server's environment: a few of ours, PATH, and the port. Nothing else, and no billing keys. */
export function childEnv(app: NodeJS.ProcessEnv, path: string, port: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH) {
    const value = app[key];
    if (value && !blockedEnvKey(key)) env[key] = value;
  }
  env.PATH = path;
  env.NODE_ENV = 'production';
  env.NODE_OPTIONS = '--disable-warning=ExperimentalWarning';
  env.OMNI_PORT = String(port);
  // This app starts the server again when it exits with RESTART_EXIT_CODE, so the Web UI offers Update.
  env.OMNI_SUPERVISOR = 'linux';
  return env;
}

/** The server's exit code after the Web UI's Update (apps/server/update.ts): start it again. */
export const RESTART_EXIT_CODE = 75;

/** Start the server again after it exited: only for Update's code, and not for one that asks again at once. */
export function shouldRestart(code: number | null, ranMs: number): boolean {
  return code === RESTART_EXIT_CODE && ranMs >= 10_000;
}

export function proofFor(token: string, port: number, nonce: string): string {
  return createHmac('sha256', token).update(`omni-proof:${port}:${nonce}`).digest('hex');
}

export function proofMatches(token: string, port: number, nonce: string, given: string): boolean {
  const expected = Buffer.from(proofFor(token, port, nonce));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export type Probe =
  | { kind: 'free' }
  | { kind: 'omni' }
  | { kind: 'not-omni'; detail: string }
  /** Something holds the port but did not answer within the probe's timeout: often Omni itself, busy or just restarted. */
  | { kind: 'slow' }
  | { kind: 'not-this-install' }
  | { kind: 'no-token' };

export function classifyAnswer(input: { token: string | null; port: number; nonce: string; status: number; body: string }): Probe {
  let parsed: { proof?: unknown } | null = null;
  try {
    parsed = JSON.parse(input.body) as { proof?: unknown };
  } catch {
    parsed = null;
  }
  const proof = typeof parsed?.proof === 'string' ? parsed.proof : null;
  if (input.status !== 200 || !proof) return { kind: 'not-omni', detail: 'the answer was not an Omni proof' };
  if (!input.token) return { kind: 'no-token' };
  if (!proofMatches(input.token, input.port, input.nonce, proof)) return { kind: 'not-this-install' };
  return { kind: 'omni' };
}

function errnoOf(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
  if (cause?.code) return cause.code;
  return cause?.errors?.find((item) => item.code)?.code;
}

export async function probePort(port: number, token: string | null, fetchImpl: typeof fetch = fetch): Promise<Probe> {
  const nonce = randomBytes(32).toString('hex');
  let response: Response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${port}/api/auth/proof?nonce=${nonce}`, { signal: AbortSignal.timeout(2000) });
  } catch (err) {
    if (errnoOf(err) === 'ECONNREFUSED') return { kind: 'free' };
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'slow' };
    return { kind: 'not-omni', detail: 'nothing answered as HTTP' };
  }
  const body = await response.text();
  return classifyAnswer({ token, port, nonce, status: response.status, body });
}

export type Decision = { action: 'start' } | { action: 'attach' } | { action: 'fail'; message: string };

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const last = trimmed[trimmed.length - 1];
  return last === '.' || last === '!' || last === '?' ? trimmed : `${trimmed}.`;
}

export function decide(probe: Probe, port: number): Decision {
  switch (probe.kind) {
    case 'free':
      return { action: 'start' };
    case 'omni':
      return { action: 'attach' };
    case 'not-omni':
      return { action: 'fail', message: `Port ${port} answers, but not as an Omni server. ${sentence(probe.detail)} Stop that program, or pick another port.` };
    case 'slow':
      return { action: 'fail', message: `Port ${port} is taken, but did not answer within 30 seconds. If it is Omni, check its log; otherwise stop that program, or pick another port.` };
    case 'not-this-install':
      return { action: 'fail', message: `Port ${port} answers, but not as this install's Omni. It does not know the token in data/api-token. Restart the server from this checkout, or pick another port.` };
    case 'no-token':
      return { action: 'fail', message: `Port ${port} answers as an Omni server, and this checkout has no data/api-token yet. Stop that server, or pick another port.` };
    default:
      return assertNever(probe);
  }
}

export type CheckoutProblem = 'missing' | 'dependencies' | 'web';

export function checkoutProblem(repo: string, exists: (path: string) => boolean): CheckoutProblem | null {
  if (!exists(join(repo, 'apps/server/index.ts'))) return 'missing';
  if (!exists(join(repo, 'node_modules/tsx/package.json'))) return 'dependencies';
  if (!exists(join(repo, 'apps/web/dist/index.html'))) return 'web';
  return null;
}

export function checkoutMessage(problem: CheckoutProblem, repo: string): string {
  switch (problem) {
    case 'missing':
      return `No Omni checkout at ${repo}.`;
    case 'dependencies':
      return `The checkout at ${repo} has no node_modules. Run npm install --include=dev there, then start again.`;
    case 'web':
      return `The checkout at ${repo} has no built Web UI. Run scripts/install-linux.sh, then start again.`;
    default:
      return assertNever(problem);
  }
}

export function tokenFile(repo: string, env: NodeJS.ProcessEnv): string {
  const dir = env.OMNI_DATA_DIR;
  if (!dir) return join(repo, 'data', 'api-token');
  return join(isAbsolute(dir) ? dir : join(repo, dir), 'api-token');
}

export function serverArgs(): string[] {
  return ['--import', 'tsx', 'apps/server/index.ts'];
}

/**
 * Probes until the answer is not `slow`: a server that was just restarted, or is stalled on disk, can take several
 * seconds to answer. Gives up after `attempts` probes and returns the last answer.
 */
export async function settleProbe(probe: () => Promise<Probe>, sleep: (ms: number) => Promise<void>, attempts = 15): Promise<Probe> {
  let last = await probe();
  for (let i = 1; i < attempts && last.kind === 'slow'; i++) {
    await sleep(250);
    last = await probe();
  }
  return last;
}

export interface WaitInput {
  probe: () => Promise<Probe>;
  exited: () => number | null;
  sleep: (ms: number) => Promise<void>;
  attempts: number;
  port: number;
  logTail: () => string;
  cancelled: () => boolean;
}

export async function waitForReady(input: WaitInput): Promise<{ ok: true } | { ok: false; message: string }> {
  let last: Probe = { kind: 'free' };
  for (let i = 0; i < input.attempts; i++) {
    if (input.cancelled()) return { ok: false, message: 'Start cancelled.' };
    const code = input.exited();
    if (code !== null) {
      const why = code === 0 ? 'The server stopped while starting.' : `The server stopped while starting, with exit code ${code}.`;
      const tail = input.logTail().trim();
      return { ok: false, message: tail ? `${why}\n${tail}` : why };
    }
    last = await input.probe();
    if (last.kind === 'omni') return { ok: true };
    if (last.kind === 'not-omni' || last.kind === 'not-this-install') {
      const decision = decide(last, input.port);
      return { ok: false, message: decision.action === 'fail' ? decision.message : 'The server on that port is not this install.' };
    }
    await input.sleep(250);
  }
  if (last.kind === 'no-token') {
    const decision = decide(last, input.port);
    return { ok: false, message: decision.action === 'fail' ? decision.message : 'This checkout has no token yet.' };
  }
  return { ok: false, message: 'The server did not answer within 30 seconds.' };
}

function assertNever(value: never): never {
  throw new Error(`unhandled ${JSON.stringify(value)}`);
}
