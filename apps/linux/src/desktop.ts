// The launcher entry and the Chromium app window. Omarchy opens a site as an app this way
// (omarchy-launch-webapp). The window has its own profile, so it is not a tab in the user's browser.
import { join } from 'node:path';

export function escapeDesktop(value: string): string {
  let out = value.replaceAll('\\', '\\\\');
  out = out.replaceAll('\t', '\\t').replaceAll('\r', '\\r').replaceAll('\n', '\\n');
  if (out.startsWith(' ')) out = `\\s${out.slice(1)}`;
  return out;
}

export function desktopEntry(input: { name: string; exec: string; icon: string }): string {
  return [
    '[Desktop Entry]',
    'Version=1.0',
    `Name=${escapeDesktop(input.name)}`,
    'Comment=Local workspace for agent work',
    `Exec=${escapeDesktop(input.exec)}`,
    'Terminal=false',
    'Type=Application',
    `Icon=${escapeDesktop(input.icon)}`,
    'Categories=Development;',
    'StartupWMClass=omni-os',
    'StartupNotify=true',
    '',
  ].join('\n');
}

function quoteExec(script: string): string {
  if (!/[\s"]/.test(script)) return script;
  return `"${script.replaceAll('"', '\\"')}"`;
}

export function installPlan(input: { home: string; repo: string; uwsm: string | null }): {
  desktopFile: string;
  desktopText: string;
  iconFile: string;
  iconSource: string;
} {
  const script = join(input.repo, 'scripts', 'omni-linux.sh');
  const exec = input.uwsm ? `${input.uwsm} -- ${quoteExec(script)}` : quoteExec(script);
  return {
    desktopFile: join(input.home, '.local/share/applications/omni-os.desktop'),
    desktopText: desktopEntry({ name: 'Omni', exec, icon: 'omni-os' }),
    iconFile: join(input.home, '.local/share/icons/hicolor/256x256/apps/omni-os.png'),
    iconSource: join(input.repo, 'apps/web/public/apple-touch-icon.png'),
  };
}

/** First token of a desktop file's Exec line, or null. */
export function execOfDesktop(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith('Exec=')) continue;
    const value = line.slice('Exec='.length).trim();
    const token = value.startsWith('"') ? value.slice(1).split('"')[0] : value.split(/\s+/)[0];
    return token || null;
  }
  return null;
}

const BROWSER_NAMES = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'brave-browser', 'brave'];

function chromiumFamily(bin: string): boolean {
  const base = bin.split('/').pop() ?? '';
  return /^(chromium|google-chrome|brave|microsoft-edge|opera|vivaldi|helium)/.test(base);
}

export function browserCommand(input: { desktopExec: string | null; path: string; isExecutable: (path: string) => boolean }): string | null {
  if (input.desktopExec && chromiumFamily(input.desktopExec) && input.isExecutable(input.desktopExec)) return input.desktopExec;
  for (const dir of input.path.split(':')) {
    if (!dir) continue;
    for (const name of BROWSER_NAMES) {
      const candidate = join(dir, name);
      if (input.isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** The Linux app opens this. The response sets the pairing cookie and redirects to the Web UI. */
export function appUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/auth/desktop-pair`;
}

export function windowArgs(url: string, profileDir: string): string[] {
  return [
    `--app=${url}`,
    '--class=omni-os',
    '--name=Omni',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--ozone-platform-hint=auto',
  ];
}

export const HELP = `Omni on Linux. Starts the server and opens it as an app window.

  scripts/omni-linux.sh
  scripts/install-linux.sh

  --install   write the launcher and icon for this checkout
  --check     print the Node, the checkout and what is on the port, then stop
  --port N    server port (default 4747)
  --repo PATH checkout to run (default: this one)
`;
