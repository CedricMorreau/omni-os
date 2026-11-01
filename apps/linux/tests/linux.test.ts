import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { appUrl, browserCommand, desktopEntry, escapeDesktop, execOfDesktop, installPlan, windowArgs } from '../src/desktop.ts';
import {
  checkoutMessage, checkoutProblem, childEnv, classifyAnswer, decide, extractPath, formatVersion,
  orderedNodeBins, parseNodeVersion, pickNode, probePort, proofFor, settleProbe, shouldRestart, tokenFile, waitForReady,
} from '../src/launch.ts';
import { acquireInstance, releaseInstance, stopGroup } from '../src/process.ts';
import { parseArgs, run } from '../src/run.ts';

const TOKEN = 'a'.repeat(64);
const NONCE = 'ab'.repeat(16);

describe('proof', () => {
  it('matches the server HMAC of omni-proof:port:nonce', () => {
    expect(proofFor(TOKEN, 4747, NONCE)).toBe('6cc24632cb5d7a85c69c27f43df9166b102dea5833504a44d5f2cef0b2a65810');
  });

  it('classifies a proof, a mismatch, a missing token and anything else', () => {
    const body = JSON.stringify({ proof: proofFor(TOKEN, 4747, NONCE) });
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('omni');
    expect(classifyAnswer({ token: 'b'.repeat(64), port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('not-this-install');
    expect(classifyAnswer({ token: null, port: 4747, nonce: NONCE, status: 200, body }).kind).toBe('no-token');
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 404, body: 'nope' }).kind).toBe('not-omni');
    expect(classifyAnswer({ token: TOKEN, port: 4747, nonce: NONCE, status: 200, body: '{' }).kind).toBe('not-omni');
  });
});

describe('node', () => {
  it('parses node -v and directory names', () => {
    expect(parseNodeVersion('v26.12.0\n')).toEqual({ major: 26, minor: 12, patch: 0 });
    expect(parseNodeVersion('26.12.0')).toEqual({ major: 26, minor: 12, patch: 0 });
    expect(parseNodeVersion('v24')).toBeNull();
    expect(formatVersion({ major: 24, minor: 1, patch: 0 })).toBe('v24.1.0');
  });

  it('tries a new enough install before PATH, and an older install after it', () => {
    const bins = orderedNodeBins({
      override: '/opt/node',
      installed: [
        { path: '/nvm/v20/bin/node', version: { major: 20, minor: 0, patch: 0 } },
        { path: '/mise/26/bin/node', version: { major: 26, minor: 12, patch: 0 } },
        { path: '/mise/24/bin/node', version: { major: 24, minor: 0, patch: 0 } },
      ],
      pathBins: ['/usr/bin/node'],
    });
    expect(bins).toEqual(['/opt/node', '/mise/26/bin/node', '/mise/24/bin/node', '/usr/bin/node', '/nvm/v20/bin/node']);
  });

  it('reports the newest Node that is still too old', async () => {
    const versions = new Map([['/old', { major: 22, minor: 0, patch: 0 }], ['/gone', null]]);
    const picked = await pickNode(['/gone', '/old'], async (path) => versions.get(path) ?? null);
    expect(picked).toEqual({ ok: false, message: 'Omni needs Node 24 or later, and /old is v22.0.0.' });
    expect(await pickNode(['/gone'], async () => null)).toEqual({ ok: false, message: 'Node 24 or later was not found. Install it, then start again.' });
  });

  it('reads PATH from between the markers', () => {
    expect(extractPath('noise\nOMNISTARTabc\n/usr/bin:/bin\nOMNIENDabc\n', 'abc')).toBe('/usr/bin:/bin');
    expect(extractPath('OMNISTARTabc\n\nOMNIENDabc', 'abc')).toBeNull();
    expect(extractPath('no markers', 'abc')).toBeNull();
  });
});

describe('server env', () => {
  it('keeps the display and drops billing keys', () => {
    const env = childEnv({
      HOME: '/home/me',
      WAYLAND_DISPLAY: 'wayland-1',
      ANTHROPIC_API_KEY: 'sk',
      OPENAI_API_KEY: 'sk',
      OMNI_TOKEN: 'secret',
      PATH: '/bad',
    }, '/home/me/.local/bin:/usr/bin', 4747);
    expect(env.HOME).toBe('/home/me');
    expect(env.WAYLAND_DISPLAY).toBe('wayland-1');
    expect(env.PATH).toBe('/home/me/.local/bin:/usr/bin');
    expect(env.NODE_ENV).toBe('production');
    expect(env.OMNI_PORT).toBe('4747');
    expect(env.OMNI_SUPERVISOR).toBe('linux');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OMNI_TOKEN).toBeUndefined();
  });

  it('uses this checkout data dir, not a data dir inherited from the shell', () => {
    expect(tokenFile('/repo', {})).toBe('/repo/data/api-token');
    expect(tokenFile('/repo', { OMNI_DATA_DIR: 'tmp/data' })).toBe('/repo/tmp/data/api-token');
  });
});

describe('decide', () => {
  it('starts when the port is free and attaches when the proof matches', () => {
    expect(decide({ kind: 'free' }, 4747)).toEqual({ action: 'start' });
    expect(decide({ kind: 'omni' }, 4747)).toEqual({ action: 'attach' });
    expect(decide({ kind: 'not-this-install' }, 4747).action).toBe('fail');
    expect(decide({ kind: 'no-token' }, 4747).action).toBe('fail');
    const foreign = decide({ kind: 'not-omni', detail: 'the answer was not an Omni proof' }, 9);
    expect(foreign.action).toBe('fail');
    if (foreign.action === 'fail') expect(foreign.message).toContain('Port 9');
  });

  it('retries a slow answer, so a busy or just-restarted server is attached to, not refused', async () => {
    let n = 0;
    const settled = await settleProbe(async () => (n++ < 3 ? { kind: 'slow' } : { kind: 'omni' }), async () => {});
    expect(settled).toEqual({ kind: 'omni' });
    expect(decide(settled, 4747)).toEqual({ action: 'attach' });
    const stuck = await settleProbe(async () => ({ kind: 'slow' }), async () => {}, 4);
    expect(stuck).toEqual({ kind: 'slow' });
    expect(decide(stuck, 4747).action).toBe('fail');
  });

  it('names a missing checkout, install and build', () => {
    expect(checkoutProblem('/repo', () => false)).toBe('missing');
    expect(checkoutProblem('/repo', (path) => path.endsWith('apps/server/index.ts'))).toBe('dependencies');
    expect(checkoutProblem('/repo', (path) => !path.endsWith('index.html'))).toBe('web');
    expect(checkoutProblem('/repo', () => true)).toBeNull();
    expect(checkoutMessage('web', '/repo')).toContain('scripts/install-linux.sh');
  });

  it('waits until the proof matches, and reports an early exit', async () => {
    let n = 0;
    const ready = await waitForReady({
      probe: async () => (n++ < 2 ? { kind: 'free' } : { kind: 'omni' }),
      exited: () => null,
      sleep: async () => {},
      attempts: 5,
      port: 4747,
      logTail: () => '',
      cancelled: () => false,
    });
    expect(ready).toEqual({ ok: true });
    const died = await waitForReady({
      probe: async () => { throw new Error('should not probe'); },
      exited: () => 1,
      sleep: async () => {},
      attempts: 3,
      port: 4747,
      logTail: () => 'port in use',
      cancelled: () => false,
    });
    expect(died.ok).toBe(false);
    if (!died.ok) expect(died.message).toContain('exit code 1');
    if (!died.ok) expect(died.message).toContain('port in use');
  });
});

describe('window', () => {
  it('does not put a token on the command line', () => {
    const url = appUrl(4747);
    expect(url).toBe('http://127.0.0.1:4747/api/auth/desktop-pair');
    expect(url).not.toContain(TOKEN);
    const args = windowArgs(url, '/tmp/omni-profile');
    expect(args.join(' ')).not.toContain(TOKEN);
    expect(args).toContain('--class=omni-os');
    expect(args).toContain(`--app=${url}`);
  });

  it('escapes a newline so it cannot add a second Exec line', () => {
    const text = desktopEntry({ name: 'Omni', exec: 'ok\nExec=rm', icon: 'omni-os' });
    expect(text.split('\n').filter((line) => line.startsWith('Exec=')).length).toBe(1);
    expect(text.split('\n').some((line) => line.startsWith('Exec=rm'))).toBe(false);
    expect(escapeDesktop(' a')).toBe('\\sa');
  });

  it('points the launcher at this checkout and at uwsm when it is there', () => {
    const plan = installPlan({ home: '/home/me', repo: '/src/omni', uwsm: '/usr/bin/uwsm-app' });
    expect(plan.desktopFile).toBe('/home/me/.local/share/applications/omni-os.desktop');
    expect(plan.desktopText).toContain('Exec=/usr/bin/uwsm-app -- /src/omni/scripts/omni-linux.sh');
    expect(plan.desktopText).toContain('StartupWMClass=omni-os');
    expect(plan.iconSource).toBe('/src/omni/apps/web/public/apple-touch-icon.png');
  });

  it('prefers Omarchy\'s browser, then chromium on PATH', () => {
    const files = new Set(['/usr/bin/chromium', '/usr/bin/brave']);
    expect(browserCommand({ desktopExec: '/usr/bin/brave', path: '/usr/bin', isExecutable: (path) => files.has(path) })).toBe('/usr/bin/brave');
    expect(browserCommand({ desktopExec: '/usr/bin/firefox', path: '/usr/bin', isExecutable: (path) => files.has(path) })).toBe('/usr/bin/chromium');
    expect(execOfDesktop('Name=Chromium\nExec=/usr/bin/chromium %U\n')).toBe('/usr/bin/chromium');
  });
});

describe('args', () => {
  it('rejects a bad port and accepts the launch flags', () => {
    expect(parseArgs(['--port', '0'])).toEqual({ error: 'omni-linux: --port needs a port from 1 to 65535' });
    expect(parseArgs(['--nope'])).toEqual({ error: 'omni-linux: unknown option --nope' });
    expect(parseArgs(['--check', '--port', '4750', '--repo', '/src'])).toMatchObject({ check: true, port: 4750, repo: '/src' });
  });

  it('prints help without touching a port', async () => {
    const lines: string[] = [];
    const code = await run(['--help'], { log: (line) => lines.push(line), error: () => {} });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('--install');
  });
});

describe('process', () => {
  it('lets the first launcher hold the socket and the next one find it busy', async () => {
    const path = join(tmpdir(), `omni-linux-${process.pid}.sock`);
    const first = await acquireInstance(path);
    expect(first).not.toBe('busy');
    if (first === 'busy') return;
    expect(await acquireInstance(path)).toBe('busy');
    await releaseInstance(first, path);
    const third = await acquireInstance(path);
    expect(third).not.toBe('busy');
    if (third !== 'busy') await releaseInstance(third, path);
  });

  it('stops a process group it started', async () => {
    const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    child.unref();
    expect(child.pid).toBeTruthy();
    await stopGroup(child.pid!);
    expect(() => process.kill(child.pid!, 0)).toThrow();
  });
});

describe('probe', () => {
  it('recognises this install, another install, and a closed port', async () => {
    const token = 'c'.repeat(64);
    const server = createServer((req, res) => {
      const nonce = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('nonce') ?? '';
      const port = (server.address() as AddressInfo).port;
      res.end(JSON.stringify({ proof: proofFor(token, port, nonce) }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      expect((await probePort(port, token)).kind).toBe('omni');
      expect((await probePort(port, 'd'.repeat(64))).kind).toBe('not-this-install');
      expect((await probePort(port, null)).kind).toBe('no-token');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    const refused = new TypeError('fetch failed');
    refused.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const fetchRefused: typeof fetch = async () => { throw refused; };
    expect((await probePort(9, token, fetchRefused)).kind).toBe('free');
    const fetchTimeout: typeof fetch = async () => { throw new DOMException('timed out', 'TimeoutError'); };
    expect((await probePort(9, token, fetchTimeout)).kind).toBe('slow');
  });
});

describe('shouldRestart', () => {
  it('starts the server again only after Update, and not in a loop', () => {
    expect(shouldRestart(75, 60_000)).toBe(true);
    expect(shouldRestart(75, 2_000)).toBe(false);
    expect(shouldRestart(0, 60_000)).toBe(false);
    expect(shouldRestart(1, 60_000)).toBe(false);
    expect(shouldRestart(null, 60_000)).toBe(false);
  });
});
