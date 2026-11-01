// Opens Omni: one instance, the server if this install is not already on the port, then the app window.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { HELP, appUrl, browserCommand, installPlan, windowArgs } from './desktop.ts';
import {
  checkoutMessage, checkoutProblem, childEnv, decide, fallbackPath, formatVersion, nodeDirFirst,
  orderedNodeBins, parseNodeVersion, pickNode, probePort, serverArgs, settleProbe, tokenFile, waitForReady,
} from './launch.ts';
import {
  acquireInstance, browserProfile, commandPath, focusWindow, installedNodes, isExecutable,
  nodeVersion, omarchyBrowserExec, readLoginPath, readTail, releaseInstance, runtimeSocket,
  spawnServer, stateLog, stopGroup, waitExit, type Spawned,
} from './process.ts';

export interface Args {
  help: boolean;
  install: boolean;
  check: boolean;
  port: number;
  repo: string | null;
}

export function parseArgs(argv: string[]): Args | { error: string } {
  const args: Args = { help: false, install: false, check: false, port: 4747, repo: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--install') args.install = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--port') {
      const value = argv[++i];
      const port = Number(value);
      if (!value || !Number.isInteger(port) || port < 1 || port > 65535) return { error: 'omni-linux: --port needs a port from 1 to 65535' };
      args.port = port;
    } else if (arg === '--repo') {
      const value = argv[++i];
      if (!value) return { error: 'omni-linux: --repo needs a path' };
      args.repo = value;
    } else return { error: `omni-linux: unknown option ${arg}` };
  }
  return args;
}

export function repoRoot(): string {
  return resolve(import.meta.dirname, '../../..');
}

export interface Io {
  log: (line: string) => void;
  error: (line: string) => void;
}

function readToken(file: string): string | null {
  try {
    const text = readFileSync(file, 'utf8').trim();
    return text.length >= 32 ? text : null;
  } catch {
    return null;
  }
}

function install(repo: string, home: string, io: Io): number {
  const plan = installPlan({ home, repo, uwsm: commandPath('uwsm-app') });
  if (!existsSync(plan.iconSource)) {
    io.error(`omni-linux: no icon at ${plan.iconSource}`);
    return 1;
  }
  mkdirSync(dirname(plan.desktopFile), { recursive: true });
  mkdirSync(dirname(plan.iconFile), { recursive: true });
  copyFileSync(plan.iconSource, plan.iconFile);
  writeFileSync(plan.desktopFile, plan.desktopText, { mode: 0o644 });
  const cache = commandPath('gtk-update-icon-cache');
  if (cache) spawnSync(cache, [join(home, '.local/share/icons/hicolor')], { stdio: 'ignore' });
  const database = commandPath('update-desktop-database');
  if (database) spawnSync(database, [dirname(plan.desktopFile)], { stdio: 'ignore' });
  const validate = commandPath('desktop-file-validate');
  if (validate) {
    const result = spawnSync(validate, [plan.desktopFile], { encoding: 'utf8' });
    if (result.status !== 0) {
      io.error((result.stderr || result.stdout || 'desktop file was rejected').trim());
      return 1;
    }
  }
  io.log(`Installed ${plan.desktopFile}`);
  io.log('Open Omni from the app launcher.');
  return 0;
}

export async function run(argv: string[], io: Io = { log: (line) => console.log(line), error: (line) => console.error(line) }): Promise<number> {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    io.error(parsed.error);
    return 2;
  }
  if (parsed.help) {
    io.log(HELP.trimEnd());
    return 0;
  }
  const home = process.env.HOME || homedir();
  const repo = resolve(parsed.repo ?? repoRoot());
  if (parsed.install) return install(repo, home, io);

  const current = parseNodeVersion(`v${process.versions.node}`);
  if (!current || current.major < 24) {
    if (process.env.OMNI_LINUX_REEXEC === '1') {
      io.error('Node 24 or later was not found. Install it, then start again.');
      return 1;
    }
    const loginPath = await readLoginPath(process.env.SHELL || '/bin/bash', process.env) ?? fallbackPath(home);
    const installed = [
      ...installedNodes(join(home, '.nvm/versions/node')),
      ...installedNodes(join(home, '.local/share/mise/installs/node')),
    ];
    const bins = orderedNodeBins({
      override: null,
      installed,
      pathBins: loginPath.split(':').filter(Boolean).map((dir) => join(dir, 'node')),
    });
    const picked = await pickNode(bins, (path) => nodeVersion(path));
    if (!picked.ok) {
      io.error(picked.message);
      return 1;
    }
    const child = spawn(picked.path, process.argv.slice(1), {
      stdio: 'inherit',
      env: { ...process.env, OMNI_LINUX_REEXEC: '1' },
    });
    return waitExit(child);
  }

  const problem = checkoutProblem(repo, existsSync);
  const loginPath = await readLoginPath(process.env.SHELL || '/bin/bash', process.env) ?? fallbackPath(home);
  const browser = browserCommand({ desktopExec: omarchyBrowserExec(), path: loginPath, isExecutable });
  const tokenPath = tokenFile(repo, {});
  const probe = () => probePort(parsed.port, readToken(tokenPath));

  if (parsed.check) {
    io.log(`node: ${process.execPath} (${formatVersion(current)})`);
    io.log(problem ? checkoutMessage(problem, repo) : `checkout: ${repo}`);
    let blocked = false;
    if (!problem) {
      const decision = decide(await probe(), parsed.port);
      blocked = decision.action === 'fail';
      const what = decision.action === 'start' ? 'free, would start the server' : decision.action === 'attach' ? 'this install, would open the window' : decision.message;
      io.log(`port ${parsed.port}: ${what}`);
    }
    io.log(browser ? `browser: ${browser}` : 'browser: Chromium was not found');
    return problem || !browser || blocked ? 1 : 0;
  }

  if (problem) {
    io.error(checkoutMessage(problem, repo));
    return 1;
  }

  const held = await acquireInstance(runtimeSocket(process.env));
  if (held === 'busy') {
    focusWindow();
    io.log('Omni is already open.');
    return 0;
  }

  let started: Spawned | null = null;
  let window: ReturnType<typeof spawn> | null = null;
  let cancelled = false;
  const onSignal = () => {
    cancelled = true;
    window?.kill('SIGTERM');
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    const decision = decide(await settleProbe(probe, (ms) => new Promise((resolve) => setTimeout(resolve, ms))), parsed.port);
    if (decision.action === 'fail') {
      io.error(decision.message);
      return 1;
    }
    if (decision.action === 'start') {
      const env = childEnv(process.env, nodeDirFirst(process.execPath, loginPath), parsed.port);
      const logFile = stateLog(process.env, home);
      started = spawnServer({ node: process.execPath, args: serverArgs(), cwd: repo, env, logFile });
      const ready = await waitForReady({
        probe,
        exited: () => started?.exited() ?? null,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        attempts: 120,
        port: parsed.port,
        logTail: () => readTail(logFile),
        cancelled: () => cancelled,
      });
      if (!ready.ok) {
        if (!cancelled) io.error(ready.message);
        return cancelled ? 0 : 1;
      }
    }
    if (cancelled) return 0;
    if (!browser) {
      io.error('Chromium was not found. Install it, then start again.');
      return 1;
    }
    const profile = browserProfile(process.env, home);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    window = spawn(browser, windowArgs(appUrl(parsed.port), profile), { stdio: 'ignore' });
    const code = await waitExit(window);
    return code === 0 ? 0 : code;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    if (started) await stopGroup(started.pid);
    await releaseInstance(held, runtimeSocket(process.env));
  }
}
