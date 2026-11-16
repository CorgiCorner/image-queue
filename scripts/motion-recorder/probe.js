// Per-frame probe: transient surfaces and anything mid-transition, with effective opacity and box.
(() => {
  const effOpacity = el => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return 0; o *= +cs.opacity; } return Math.round(o * 1000) / 1000; };
  const nameOf = el => (el.getAttribute('aria-label') || el.getAttribute('role') || el.tagName.toLowerCase()) + ':' + (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const SEL = '[data-slot=tooltip-content],[data-side][role=presentation] > *,[role=dialog],[role=alertdialog],[role=listbox],[role=menu],[role=tooltip],[role=status],[role=alert],[role=toolbar],[data-popup-open],[aria-live] > *';
  window.__probe = () => {
    const out = {};
    for (const el of document.querySelectorAll(SEL)) { const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue; out[nameOf(el)] = [effOpacity(el), Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), getComputedStyle(el).transform]; }
    const anims = document.getAnimations();
    out.__anims = anims.length;
    out.__animInfo = anims.slice(0, 40).map(a => { const t = a.effect && a.effect.target; const kf = a.effect && a.effect.getKeyframes ? [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(x => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))] : []; return [t ? (t.className && typeof t.className === 'string' ? t.className.split(' ')[0] : t.tagName) + (t.dataset && t.dataset.jobId ? '#' + t.dataset.jobId.slice(-4) : '') : '?', a.constructor.name, kf.join('+') || a.transitionProperty || a.animationName || '', Math.round(a.effect.getComputedTiming().duration), Math.round(a.currentTime || 0)]; });
    out.__cardsMoving = [...document.querySelectorAll('.virtual-card')].filter(c => { const t = getComputedStyle(c).transform; return t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)'; }).length;
    out.__flight = document.querySelectorAll('.shared-image-flight').length;
    out.__cards = [...document.querySelectorAll('.virtual-card')].slice(0, 3).map(c => (c.dataset.jobId || '').slice(-4)).join(',');
    return out;
  };
  window.__rect = spec => {
    const re = new RegExp(spec.name);
    const cands = [...document.querySelectorAll(spec.css || 'button,[role=button],[role=checkbox],[role=combobox],[role=option],[role=menuitem],a,input,textarea,[aria-label]')];
    const el = cands.filter(e => { const n = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' '); return re.test(n); })[spec.index || 0];
    if (!el) return null;
    if (spec.scroll) el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
})();
