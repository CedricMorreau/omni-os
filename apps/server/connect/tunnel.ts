// Runs cloudflared for this machine's Omni Connect tunnel (docs/adr/0009-omni-connect.md): restarts it with backoff,
// and after RECOVER_AFTER exits in RECOVER_WINDOW_MS asks for a fresh tunnel (the relay provisions it again, same
// hostname). The token goes in the child's environment, never its arguments, so `ps` does not show it.
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export type TunnelState = 'off' | 'starting' | 'connected' | 'restarting' | 'missing';

export interface TunnelStatus {
  state: TunnelState;
  /** The last line cloudflared logged as an error, or why it could not start. */
  error: string | null;
  cloudflared: string | null;
}

/** The part of a child process the supervisor uses. Tests pass a fake. */
export interface TunnelChild {
  onLine(fn: (line: string) => void): void;
  onExit(fn: (code: number | null) => void): void;
  kill(): void;
}

export type Spawn = (bin: string, token: string) => TunnelChild;

const RECOVER_AFTER = 5;
const RECOVER_WINDOW_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 60_000;

/** cloudflared from OMNI_CLOUDFLARED, else PATH, else where Homebrew puts it (launchd's PATH has neither). */
export function findCloudflared(env = process.env): string | null {
  const executable = (p: string) => {
    try {
      accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (env.OMNI_CLOUDFLARED) return executable(env.OMNI_CLOUDFLARED) ? env.OMNI_CLOUDFLARED : null;
  const dirs = [...(env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  return dirs.map((d) => join(d, 'cloudflared')).find(executable) ?? null;
}

export const spawnCloudflared: Spawn = (bin, token) => {
  const child: ChildProcess = spawn(bin, ['tunnel', '--no-autoupdate', 'run'], {
    env: { ...process.env, TUNNEL_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines: ((line: string) => void)[] = [];
  const feed = (buf: Buffer) => {
    for (const line of buf.toString('utf8').split('\n')) if (line.trim()) lines.forEach((fn) => fn(line));
  };
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);
  return {
    onLine: (fn) => void lines.push(fn),
    onExit: (fn) => {
      child.on('exit', (code) => fn(code));
      child.on('error', () => fn(null));
    },
    kill: () => void child.kill('SIGTERM'),
  };
};

export class TunnelSupervisor {
  private child: TunnelChild | null = null;
  private token: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private exits: number[] = [];
  private attempt = 0;
  private status: TunnelStatus = { state: 'off', error: null, cloudflared: null };

  constructor(
    /** A fresh connector token after repeated exits, or null to keep the one it has. */
    private readonly recover: () => Promise<string | null>,
    private readonly find: () => string | null = findCloudflared,
    private readonly spawnImpl: Spawn = spawnCloudflared,
    private readonly now: () => number = Date.now,
    private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = (fn, ms) => setTimeout(fn, ms).unref(),
  ) {}

  get current(): TunnelStatus {
    return { ...this.status };
  }

  start(token: string) {
    this.stop();
    this.token = token;
    this.attempt = 0;
    this.exits = [];
    this.run();
  }

  stop() {
    this.token = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null;
    child?.kill();
    this.status = { state: 'off', error: null, cloudflared: this.status.cloudflared };
  }

  private run() {
    const token = this.token;
    if (!token) return;
    const bin = this.find();
    if (!bin) {
      this.status = { state: 'missing', error: 'cloudflared is not installed. Install it (brew install cloudflared), or set OMNI_CLOUDFLARED to its path', cloudflared: null };
      // Look again later: installing it should not need a restart.
      this.timer = this.schedule(() => this.run(), MAX_BACKOFF_MS);
      return;
    }
    this.status = { state: this.attempt ? 'restarting' : 'starting', error: this.status.error, cloudflared: bin };
    const child = this.spawnImpl(bin, token);
    this.child = child;
    child.onLine((line) => {
      if (this.child !== child) return;
      if (/Registered tunnel connection/i.test(line)) {
        this.attempt = 0;
        this.status = { ...this.status, state: 'connected', error: null };
      } else if (/\b(ERR|error)\b/.test(line)) this.status = { ...this.status, error: line.replace(/^\S+\s+ERR\s+/, '').slice(0, 300) };
    });
    child.onExit((code) => {
      if (this.child !== child) return;
      this.child = null;
      void this.exited(code);
    });
  }

  private async exited(code: number | null) {
    if (!this.token) return;
    const at = this.now();
    this.exits = [...this.exits.filter((t) => at - t < RECOVER_WINDOW_MS), at];
    this.status = { ...this.status, state: 'restarting', error: this.status.error ?? `cloudflared exited (${code ?? 'signal'})` };
    if (this.exits.length >= RECOVER_AFTER) {
      this.exits = [];
      const fresh = await this.recover().catch((err: Error) => {
        this.status = { ...this.status, error: `Could not get a fresh tunnel: ${err.message}` };
        return null;
      });
      if (!this.token) return;
      if (fresh) this.token = fresh;
    }
    const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt++);
    this.timer = this.schedule(() => this.run(), wait);
  }
}
