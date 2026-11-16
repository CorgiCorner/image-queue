// Minimal CDP client (Node built-in WebSocket) for an isolated Chrome for Testing (agent-browser's copy).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const CHROME = process.env.CHROME_PATH; // Chrome for Testing binary
export async function launch({ width = 1440, height = 900, port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'iq-rec-profile-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width},${height}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(m.error.message + ' ' + (m.error.data || ''))) : r(m.result); } else if (m.method) listeners.forEach(l => l(m)); };
  const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  const on = l => listeners.push(l);
  const close = () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 500); };
  return { send, on, close, proc };
}
