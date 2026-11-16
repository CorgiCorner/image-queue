// Deterministic 60 fps renderer for follow-up 08, section 8.
// usage: node render.mjs <scene> <normal|quarter|reduced> <outdir>
import { launch } from './cdp.mjs';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { scenes } from './scenes.mjs';
const APPDIR = process.env.REC_APP || 'app';
const S = process.env.REC_ROOT; // work folder: <REC_APP or app>/ (built export), data-pristine*/, out/
const PORT = +(process.env.REC_PORT || 3477), APP = `http://127.0.0.1:${PORT}/`;
const DATA = PORT === 3477 ? 'data' : `data-${PORT}`;
const [sceneName, mode, outRoot] = process.argv.slice(2);
const scene = scenes[sceneName];
const STEP = mode === 'quarter' ? 1000 / 240 : 1000 / 60; // page ms per output frame (output is always 60 fps)

function resetServer() {
  try { const pid = +readFileSync(join(S, `server-${PORT}.pid`), 'utf8'); process.kill(-pid, 'SIGTERM'); } catch {}
  execFileSync('sh', ['-c', `lsof -tiTCP:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null; for i in $(seq 50); do lsof -iTCP:${PORT} -sTCP:LISTEN >/dev/null || exit 0; sleep 0.1; done; exit 1`]);
  rmSync(join(S, DATA), { recursive: true, force: true });
  cpSync(join(S, PORT === 3477 ? 'data-pristine' : `data-pristine-${PORT}`), join(S, DATA), { recursive: true });
  const env = { ...process.env, IMAGE_QUEUE_STORAGE_DIR: join(S, DATA, 'store'), IMAGE_QUEUE_QUEUE_DIR: join(S, DATA, 'queue'), IMAGE_QUEUE_CREDENTIALS_DIR: join(S, DATA, 'credentials') };
  const p = spawn(join(S, APPDIR, 'node_modules/.bin/next'), ['start', '--hostname', '127.0.0.1', '--port', String(PORT)], { cwd: join(S, APPDIR), env, stdio: ['ignore', 'ignore', 'ignore'], detached: true });
  p.unref(); writeFileSync(join(S, `server-${PORT}.pid`), String(p.pid));
  execFileSync('sh', ['-c', `for i in $(seq 100); do curl -sf -o /dev/null ${APP}api/state && exit 0; sleep 0.1; done; exit 1`]);
}

const out = join(outRoot, `${sceneName}-${mode}`);
rmSync(out, { recursive: true, force: true }); mkdirSync(join(out, 'frames'), { recursive: true });
resetServer();
const b = await launch({ port: 9340 + Math.floor(Math.random() * 50) });
const { send } = b;
const logs = [];
b.on(m => { if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERR ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode === 'reduced' ? 'reduce' : 'no-preference' }, { name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('./clock.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('./probe.js', import.meta.url), 'utf8') });
await send('Page.navigate', { url: APP });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ' -> ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
for (let i = 0; i < 100; i++) { try { if (await ev('!!window.__vt && document.readyState === "complete"')) break; } catch {} await new Promise(r => setTimeout(r, 100)); }

let frame = 0; const probes = []; let recording = false;
async function tick() {
  const vt = await ev(`window.__vt.tick(${STEP})`);
  if (!recording) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, 'frames', String(frame).padStart(5, '0') + '.png'), Buffer.from(data, 'base64'));
  probes.push({ frame, vt: Math.round(vt * 100) / 100, items: await ev('window.__probe()') });
  frame++;
}
// settle: page time advances in steps while real time lets data load
async function settle(pageMs) { for (let t = 0; t < pageMs; t += 1000 / 60) { await ev(`window.__vt.tick(${1000 / 60})`); await new Promise(r => setTimeout(r, 15)); } }
const rect = async (spec) => { const r = await ev(`window.__rect(${JSON.stringify(spec)})`); if (!r) throw new Error('not found: ' + JSON.stringify(spec)); return r; };
const mouse = { x: 1300, y: 860 };
const api = {
  // page-time wait, in real-tempo ms; recorded frames = ms/ (1000/60) regardless of mode
  wait: async (ms) => { const n = Math.round(ms / (1000 / 60)) * (mode === 'quarter' ? 4 : 1); for (let i = 0; i < n; i++) await tick(); },
  move: async (spec, dx = 0, dy = 0) => { const r = await rect(spec); mouse.x = r.x + r.width / 2 + dx; mouse.y = r.y + r.height / 2 + dy; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mouse.x, y: mouse.y, pointerType: 'mouse' }); },
  moveTo: async (x, y) => { mouse.x = x; mouse.y = y; await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); },
  down: async () => send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mouse.x, y: mouse.y, button: 'left', buttons: 1, clickCount: 1 }),
  up: async () => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mouse.x, y: mouse.y, button: 'left', buttons: 0, clickCount: 1 }),
  click: async (spec) => { await api.move(spec); await api.down(); await api.up(); },
  key: async (key, code = key, keyCode = 0) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode }); },
  type: async (text) => send('Input.insertText', { text }),
  settle, ev,
  record: (on) => { recording = on; },
};
let error = null;
try {
  await settle(1500);
  for (let i = 0; i < 100 && !(await ev("document.querySelectorAll('.virtual-card img').length > 0")); i++) await settle(100);
  await scene.setup?.(api);
  await settle(800);
  recording = true;
  await scene.run(api);
} catch (e) { error = String(e.stack || e); try { const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, 'error.png'), Buffer.from(data, 'base64')); error += ' url=' + await ev('location.href'); } catch {} }
recording = false;
b.close();
writeFileSync(join(out, 'probes.json'), JSON.stringify(probes));
writeFileSync(join(out, 'run.json'), JSON.stringify({ scene: sceneName, mode, stepMs: STEP, frames: frame, sha: readFileSync(join(S, `${APPDIR}-sha`), 'utf8').trim(), error, logs }, null, 1));
if (frame) execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '60', '-i', join(out, 'frames/%05d.png'), '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', '60', join(outRoot, `${sceneName}-${mode}.mp4`)]);
console.log(JSON.stringify({ scene: sceneName, mode, frames: frame, error: error && error.slice(0, 400), logs: logs.slice(0, 5) }));
process.exit(0);
