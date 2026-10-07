import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [name], {encoding:'utf8'}).trim(); } catch { /* Try the installed alternative. */ }
  }
  throw new Error('Install Chrome or set CHROME_PATH to the installed executable.');
}
