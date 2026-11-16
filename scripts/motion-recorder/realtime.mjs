// Real-time check (no virtual clock): samples every real rendered frame (rAF) after an action.
// usage: node realtime.mjs <archive|insert|preview> <normal|reduced> <cpuRate>
import { launch } from './cdp.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { rmSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const APPDIR = process.env.REC_APP || 'app';
const S = process.env.REC_ROOT; // work folder: <REC_APP or app>/ (built export), data-pristine*/, out/
const PORT = 3480, APP = `http://127.0.0.1:${PORT}/`;
const [what, mode, cpu = '1'] = process.argv.slice(2);
try { execFileSync('sh', ['-c', `lsof -tiTCP:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 0.5`]); } catch {}
rmSync(join(S, 'data-3480'), { recursive: true, force: true }); cpSync(join(S, 'data-pristine-3480'), join(S, 'data-3480'), { recursive: true });
const env = { ...process.env, IMAGE_QUEUE_STORAGE_DIR: join(S, 'data-3480/store'), IMAGE_QUEUE_QUEUE_DIR: join(S, 'data-3480/queue'), IMAGE_QUEUE_CREDENTIALS_DIR: join(S, 'data-3480/credentials') };
const srv = spawn(join(S, APPDIR, 'node_modules/.bin/next'), ['start', '--hostname', '127.0.0.1', '--port', String(PORT)], { cwd: join(S, APPDIR), env, stdio: 'ignore', detached: true });
execFileSync('sh', ['-c', `for i in $(seq 100); do curl -sf -o /dev/null ${APP}api/state && exit 0; sleep 0.1; done; exit 1`]);
const b = await launch({ port: 9400 + Math.floor(Math.random() * 50) });
const { send } = b;
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: mode === 'reduced' ? 'reduce' : 'no-preference' }] });
await send('Page.navigate', { url: APP });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
await new Promise(r => setTimeout(r, 2500));
await ev(`(${() => {
  const eff = el => { if (getComputedStyle(el).visibility === 'hidden') return 0; let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  window.__samples = []; window.__sampling = false;
  window.__startSampling = () => { window.__samples = []; const t0 = performance.now(); window.__sampling = true;
    const loop = () => { if (!window.__sampling) return; const cards = [...document.querySelectorAll('.virtual-card')];
      const first = cards.find(c => { const r = c.getBoundingClientRect(); return r.top > 150 && r.top < 700; });
      const flight = document.querySelector('.shared-image-flight');
      const stage = document.querySelector('[data-slot=dialog-content] img');
      window.__samples.push({ t: Math.round(performance.now() - t0), gallery: first ? Math.round(eff(first) * 100) / 100 : null, cards: cards.length, moving: cards.filter(c => getComputedStyle(c).transform !== 'none').length, flight: flight ? Math.round(eff(flight) * 100) / 100 : 0, stage: stage ? Math.round(eff(stage) * 100) / 100 : 0, anims: document.getAnimations().length });
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop); };
}})()`);
const rect = async name => ev(`(() => { const re = new RegExp(${JSON.stringify(name)}); const el = [...document.querySelectorAll('button,[role=checkbox],[role=option],[role=combobox],textarea,[aria-label]')].find(e => re.test((e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' '))); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async name => { const p = await rect(name); if (!p) throw new Error('missing ' + name); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (+cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: +cpu });
if (what === 'archive') { await click('^Select Landscape study 21\\.png$'); await sleep(300); await click('^Select Landscape study 20\\.png$'); await sleep(400); await ev('window.__startSampling()'); await click('^Archive$'); }
if (what === 'insert') { await click('^Generation source$'); await sleep(400); await click('^Codex queue$'); await sleep(400); await click('^Image prompt$'); await send('Input.insertText', { text: 'A lighthouse at dawn' }); await sleep(400); await ev('window.__startSampling()'); await click('^Generate image|^Queue image|^Add to queue'); }
if (what === 'filter') { await ev('window.__startSampling()'); await click('^Studio collection'); }
if (what === 'preview') { await ev('window.__startSampling()'); await click('^Ready: Landscape study 22\\.png$'); }
await sleep(2000 * Math.max(1, +cpu / 2));
const samples = await ev('(window.__sampling = false, window.__samples)');
b.close(); try { process.kill(-srv.pid); } catch { srv.kill(); }
writeFileSync(join(S, `rt-${what}-${mode}-cpu${cpu}.json`), JSON.stringify(samples));
const show = samples.filter((s, i) => i < 40);
console.log(what, mode, 'cpu' + cpu, 'frames', samples.length);
for (const s of show) console.log(' ', JSON.stringify(s));
process.exit(0);
