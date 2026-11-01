// Process work the launcher does: find Node, hold one instance, start the server, stop its process group.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execOfDesktop } from './desktop.ts';
import { extractPath, parseNodeVersion, type NodeVersion } from './launch.ts';

export function isExecutable(path: string): boolean {
  try {
    const info = statSync(path);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function installedNodes(root: string): { path: string; version: NodeVersion }[] {
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return [];
  }
  const out: { path: string; version: NodeVersion }[] = [];
  for (const name of names) {
    const version = parseNodeVersion(name);
    if (version) out.push({ path: join(root, name, 'bin', 'node'), version });
  }
  return out;
}

export function nodeVersion(bin: string, timeoutMs = 5000): Promise<NodeVersion | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-v'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    child.stdout?.on('data', (buf: Buffer) => { out += buf.toString(); });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? parseNodeVersion(out) : null);
    });
  });
}

function minimalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (env[key]) out[key] = env[key];
  }
  return out;
}

/** PATH from the user's login shell, or null when it does not answer in time. */
export function readLoginPath(shell: string, env: NodeJS.ProcessEnv, timeoutMs = 5000): Promise<string | null> {
  const id = randomBytes(8).toString('hex');
  const command = `printf '%s%s\\n%s\\n%s%s' OMNI 'START${id}' "$PATH" OMNI 'END${id}'`;
  return new Promise((resolve) => {
    const child = spawn(shell, ['-lc', command], { env: minimalEnv(env), stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    child.stdout?.on('data', (buf: Buffer) => { out += buf.toString(); });
    child.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolve(extractPath(out, id));
    });
  });
}

export function commandPath(name: string): string | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  const result = spawnSync('bash', ['-c', 'command -v "$1"', 'bash', name], { encoding: 'utf8' });
  const path = result.stdout.trim().split('\n')[0];
  return result.status === 0 && path ? path : null;
}

/** Exec binary from Omarchy's default browser desktop file, when that command exists. */
export function omarchyBrowserExec(): string | null {
  const listed = spawnSync('omarchy-cmd-default-browser', [], { encoding: 'utf8', timeout: 2000 });
  if (listed.status !== 0) return null;
  const name = listed.stdout.trim();
  if (!/^[\w.-]+\.desktop$/.test(name)) return null;
  const files = [
    process.env.HOME ? join(process.env.HOME, '.local/share/applications', name) : '',
    join('/usr/share/applications', name),
  ];
  for (const file of files) {
    if (!file) continue;
    try {
      return execOfDesktop(readFileSync(file, 'utf8'));
    } catch {
      // The next search path may have it.
    }
  }
  return null;
}

export function runtimeSocket(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_RUNTIME_DIR || join(tmpdir(), 'omni-os');
  return join(base, 'omni-os', 'instance.sock');
}

export function stateLog(env: NodeJS.ProcessEnv, home: string): string {
  const base = env.XDG_STATE_HOME || join(home, '.local/state');
  return join(base, 'omni-os', 'server.log');
}

export function browserProfile(env: NodeJS.ProcessEnv, home: string): string {
  const base = env.XDG_DATA_HOME || join(home, '.local/share');
  return join(base, 'omni-os', 'browser');
}

/** One launcher at a time. A leftover socket from a crash is removed when nothing is listening. */
export function acquireInstance(path: string): Promise<Server | 'busy'> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  return new Promise((resolve, reject) => {
    let settled = false;
    const probe = createConnection(path);
    const listen = () => {
      try { unlinkSync(path); } catch { /* no stale file */ }
      const server = createServer();
      server.unref();
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') resolve('busy');
        else reject(err);
      });
      server.listen(path, () => {
        try { chmodSync(path, 0o600); } catch { /* the listen already succeeded */ }
        resolve(server);
      });
    };
    probe.once('connect', () => {
      settled = true;
      probe.end();
      resolve('busy');
    });
    probe.once('error', () => {
      if (settled) return;
      settled = true;
      listen();
    });
  });
}

export async function releaseInstance(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { unlinkSync(path); } catch { /* already gone */ }
}

export interface Spawned {
  pid: number;
  exited: () => number | null;
}

export function spawnServer(input: { node: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; logFile: string }): Spawned {
  mkdirSync(dirname(input.logFile), { recursive: true, mode: 0o700 });
  const fd = openSync(input.logFile, 'a', 0o600);
  try {
    const child = spawn(input.node, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    let code: number | null = null;
    child.once('exit', (status) => { code = status ?? 0; });
    child.once('error', () => { code = 1; });
    child.unref();
    if (!child.pid) throw new Error('Could not start the server.');
    return { pid: child.pid, exited: () => code };
  } finally {
    closeSync(fd);
  }
}

export function readTail(file: string, lines = 20): string {
  try {
    const text = readFileSync(file);
    const slice = text.subarray(Math.max(0, text.length - 8000)).toString('utf8');
    return slice.split('\n').slice(-lines).join('\n').trim();
  } catch {
    return '';
  }
}

/** SIGTERM the process group we started, then SIGKILL if it is still there. */
export async function stopGroup(pid: number, waitMs = 5000): Promise<void> {
  const kill = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); } catch { /* already gone */ }
  };
  kill('SIGTERM');
  const start = Date.now();
  while (Date.now() - start < waitMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  kill('SIGKILL');
}

export function waitExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve(code);
    };
    child.once('error', () => finish(127));
    child.once('exit', (code) => finish(code ?? 1));
  });
}

export function focusWindow(): void {
  if (!commandPath('hyprctl')) return;
  spawn('hyprctl', ['dispatch', 'focuswindow', 'class:^(omni-os)$'], { stdio: 'ignore' }).unref();
}
