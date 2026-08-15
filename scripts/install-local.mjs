/**
 * Copy the freshly built app over the installed one, so the desktop shortcut
 * picks up the new version without running the NSIS installer.
 *
 * The install is just `app.exe` next to `uninstall.exe`, so replacing the one
 * file is a complete update. Going through the installer instead means clicking
 * past a SmartScreen warning and a wizard every single time.
 *
 * Run `npm run install-app` (builds first) or `node scripts/install-local.mjs`
 * on its own if you have already built.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const built = join(root, 'src-tauri', 'target', 'release', 'app.exe');
const installDir = join(process.env.LOCALAPPDATA ?? '', 'KnitChart');
const installed = join(installDir, 'app.exe');

const fail = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

if (process.platform !== 'win32') fail('This only applies to the Windows build.');
if (!existsSync(built)) fail(`No build found at ${built}\n  Run "npx tauri build" first.`);

// Windows locks a running .exe, so the copy would fail with a confusing
// permissions error. Say so plainly instead. If the check itself cannot run we
// carry on: the copy either works or reports its own error.
let running = null;
try {
  running = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', '(Get-Process app -ErrorAction SilentlyContinue | Measure-Object).Count'],
    { encoding: 'utf8' }
  ).trim();
} catch {
  console.warn('  (could not check whether KnitChart is open; trying anyway)');
}
if (running !== null && running !== '0') {
  fail('KnitChart is open. Close it and run this again.');
}

if (!existsSync(installDir)) {
  // First run on a machine that has never had the installer: make the folder,
  // but say so, because there will be no Start menu entry or uninstaller.
  mkdirSync(installDir, { recursive: true });
  console.log(`  Created ${installDir} (no previous install found).`);
}

copyFileSync(built, installed);
const { size, mtime } = statSync(installed);
console.log(`\n  Updated ${installed}`);
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB, built ${mtime.toLocaleString()}`);
console.log('  Your desktop shortcut now opens this build.\n');
