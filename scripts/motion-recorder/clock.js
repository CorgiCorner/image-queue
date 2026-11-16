// Virtual clock injected before any page script. All time the page can see (performance.now, Date,
// timers, requestAnimationFrame, CSS transitions and Web Animations) follows window.__vt, which only
// the recorder advances. Each frame is therefore a still, settled state at an exact time.
(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const realPerfNow = performance.now.bind(performance);
  const RealDate = Date;
  const perfBase = realPerfNow();
  const dateBase = RealDate.now();
  let vt = 0; // ms since injection
  performance.now = () => perfBase + vt;
  class VDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(dateBase + vt); else super(...a); }
    static now() { return dateBase + vt; }
  }
  window.Date = VDate;
  // timers
  let tid = 1; const timers = new Map();
  window.setTimeout = (fn, ms = 0, ...args) => { const id = tid++; timers.set(id, { at: vt + Math.max(0, +ms || 0), fn, args, every: 0 }); return id; };
  window.setInterval = (fn, ms = 0, ...args) => { const id = tid++; const every = Math.max(1, +ms || 0); timers.set(id, { at: vt + every, fn, args, every }); return id; };
  window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
  window.requestIdleCallback = (fn) => window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 10 }), 1);
  window.cancelIdleCallback = id => timers.delete(id);
  let rid = 1; let rafs = new Map();
  window.requestAnimationFrame = fn => { const id = rid++; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = id => { rafs.delete(id); };
  // animations
  const track = new WeakMap(); // anim -> {startVt, startCt}
  const appPaused = new WeakSet();
  const P = Animation.prototype;
  const nPause = P.pause, nPlay = P.play, nReverse = P.reverse;
  // Any animation the page starts is frozen at once and owned by the virtual clock from the current vt.
  const adopt = (a, ct) => { track.set(a, { startVt: vt, startCt: ct }); nPause.call(a); };
  P.pause = function () { appPaused.add(this); return nPause.call(this); };
  P.play = function () { appPaused.delete(this); const r = nPlay.call(this); adopt(this, this.currentTime || 0); return r; };
  P.reverse = function () { appPaused.delete(this); const r = nReverse.call(this); adopt(this, this.currentTime || 0); return r; };
  const nAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = nAnimate.apply(this, args); adopt(a, 0); return a; };
  const endOf = a => { const t = a.effect && a.effect.getComputedTiming(); return t ? t.endTime : 0; };
  function stepAnimations() {
    for (const a of document.getAnimations()) {
      if (a.playState === 'finished' || a.playState === 'idle') { track.delete(a); continue; }
      if (appPaused.has(a)) continue;
      let t = track.get(a);
      // not adopted yet (a CSS transition or animation started by a style change): it began at the current vt
      if (!t || a.playState === 'running') { adopt(a, t && a.playState === 'running' ? (a.currentTime || 0) : 0); t = track.get(a); }
      const rate = a.playbackRate;
      const ct = t.startCt + (vt - t.startVt) * rate;
      const end = endOf(a);
      if (rate > 0 && Number.isFinite(end) && ct >= end) { a.finish(); track.delete(a); }
      else if (rate < 0 && ct <= 0) { a.finish(); track.delete(a); }
      else a.currentTime = ct;
    }
  }
  const flush = () => new Promise(r => queueMicrotask(r));
  async function runTimers(until) {
    for (let guard = 0; guard < 10000; guard++) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
      if (!next) break;
      const [id, t] = next;
      if (t.every) t.at += t.every; else timers.delete(id);
      try { t.fn(...t.args); } catch (e) { console.error(e); }
      await flush();
    }
  }
  window.__vt = {
    get now() { return vt; },
    pending() { return { timers: timers.size, rafs: rafs.size, anims: document.getAnimations().length }; },
    async tick(step) {
      const target = vt + step;
      await runTimers(target);
      vt = target;
      const cbs = rafs; rafs = new Map();
      const ts = perfBase + vt;
      for (const fn of cbs.values()) { try { fn(ts); } catch (e) { console.error(e); } }
      await flush();
      stepAnimations();
      await flush(); await flush();
      stepAnimations();
      // let the browser paint this state (real frames; page time does not move)
      await new Promise(r => nativeRAF(() => nativeRAF(r)));
      // renders that landed while the browser painted may have started transitions: freeze them at vt, repaint
      stepAnimations();
      await new Promise(r => nativeRAF(() => nativeRAF(r)));
      return vt;
    },
    realSleep: ms => new Promise(r => nativeSetTimeout(r, ms)),
  };
})();
