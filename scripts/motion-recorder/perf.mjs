// Performance trace of the heaviest interaction per area, real time, CPU throttled 4x (section 7/8).
// usage: node perf.mjs <outdir>
import { launch } from './cdp.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { rmSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const S = process.env.REC_ROOT; // work folder: app/ (built export), data-pristine*/, out/
const PORT = 3481, APP = `http://127.0.0.1:${PORT}/`;
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cases = {
  p1_dialog_open: async c => { await c.click('^New project$'); },
  p2_layout_change: async c => { await c.click('^Masonry layout$'); },
  p2_archive_two: async c => { await c.click('^Select Landscape study 21\\.png$'); await sleep(400); await c.click('^Select Landscape study 20\\.png$'); await sleep(400); await c.mark(); await c.click('^Archive$'); },
  p3_preview_open: async c => { await c.click('^Ready: Landscape study 22\\.png$'); },
  p4_queue_submit: async c => { await c.click('^Generation source$'); await sleep(500); await c.click('^Codex queue$'); await sleep(500); await c.click('^Image prompt$'); await c.send('Input.insertText', { text: 'A lighthouse at dawn' }); await sleep(500); await c.mark(); await c.click('^Generate image|^Queue image|^Add to queue'); },
  p5_restore: async c => { await c.click('^Select Landscape study 24\\.png$'); await sleep(400); await c.click('^Move to trash$'); await sleep(800); await c.click('^Trash'); await sleep(9500); await c.click('^Select Landscape study 24\\.png$'); await sleep(500); await c.mark(); await c.click('^Restore'); },
};
const results = {};
for (const [name, run] of Object.entries(cases)) {
  try { execFileSync('sh', ['-c', `lsof -tiTCP:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 0.5`]); } catch {}
  rmSync(join(S, 'data-3481'), { recursive: true, force: true }); cpSync(join(S, 'data-pristine-3481'), join(S, 'data-3481'), { recursive: true });
  const env = { ...process.env, IMAGE_QUEUE_STORAGE_DIR: join(S, 'data-3481/store'), IMAGE_QUEUE_QUEUE_DIR: join(S, 'data-3481/queue'), IMAGE_QUEUE_CREDENTIALS_DIR: join(S, 'data-3481/credentials') };
  const srv = spawn(join(S, 'app/node_modules/.bin/next'), ['start', '--hostname', '127.0.0.1', '--port', String(PORT)], { cwd: join(S, 'app'), env, stdio: 'ignore', detached: true });
  execFileSync('sh', ['-c', `for i in $(seq 100); do curl -sf -o /dev/null ${APP}api/state && exit 0; sleep 0.1; done; exit 1`]);
  const b = await launch({ port: 9450 + Math.floor(Math.random() * 40) });
  const { send } = b;
  const events = []; let done;
  b.on(m => { if (m.method === 'Tracing.dataCollected') events.push(...m.params.value); if (m.method === 'Tracing.tracingComplete') done?.(); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
  await sleep(3000);
  await ev(`window.__ev = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push([e.name, Math.round(e.duration)]); }).observe({ type: 'event', durationThreshold: 16, buffered: false }); window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift' }); 1`);
  const rect = async n => ev(`(() => { const re = new RegExp(${JSON.stringify(n)}); const el = [...document.querySelectorAll('button,[role=checkbox],[role=option],[role=combobox],textarea,[aria-label]')].find(e => re.test((e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' '))); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  let marked = false;
  const c = { send, click: async n => { const p = await rect(n); if (!p) throw new Error('missing ' + n); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); },
    mark: async () => { marked = true; await send('Emulation.setCPUThrottlingRate', { rate: 4 }); await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,loading', transferMode: 'ReportEvents' }); await ev('window.__ev = []; window.__cls = 0; 1'); } };
  const needsMark = run.toString().includes('c.mark()');
  if (!needsMark) await c.mark();
  let err = null;
  try { await run(c); } catch (e) { err = String(e); }
  await sleep(2500);
  const page = await ev('({ events: window.__ev, cls: window.__cls })');
  const fin = new Promise(r => { done = r; }); await send('Tracing.end'); await fin;
  b.close(); try { process.kill(-srv.pid); } catch {}
  writeFileSync(join(out, `${name}.trace.json`), JSON.stringify({ traceEvents: events }));
  const main = events.filter(e => e.name === 'RunTask' && e.ph === 'X' && e.cat?.includes('devtools.timeline'));
  const long = main.filter(e => e.dur > 50000).map(e => Math.round(e.dur / 1000));
  const frames = events.filter(e => e.name === 'DroppedFrame' || e.name === 'Frame::Dropped' || (e.name === 'PipelineReporter' && e.args?.chrome_frame_reporter?.state === 'STATE_DROPPED')).length;
  results[name] = { error: err, longTasksOver50ms: long, maxTaskMs: Math.round(Math.max(0, ...main.map(e => e.dur)) / 1000), interactions: page.events, maxInteractionMs: Math.max(0, ...page.events.map(e => e[1])), cls: Math.round(page.cls * 10000) / 10000, droppedFrames: frames };
  console.log(name, JSON.stringify(results[name]));
}
writeFileSync(join(out, 'perf-summary.json'), JSON.stringify(results, null, 1));
process.exit(0);
