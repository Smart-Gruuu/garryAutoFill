/* Garry AutoFill - in-page UI: floating button, result panel, field highlights. Rendered inside a closed shadow root. */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.ui) return;
  const D = GAF.dom;

  const COLORS = { filled: '#16a34a', skipped: '#d97706', failed: '#dc2626' };
  const REASONS = {
    essay: 'Open-ended question \u2014 yours to answer',
    consent: 'Agreement / signature \u2014 review it yourself',
    sensitive: 'Sensitive \u2014 left blank on purpose',
    failed: 'Could not set this one \u2014 please check',
    nodata: 'Required, but your profile has no answer',
    unknown: 'Required question the extension does not recognise',
  };

  const marks = new Map();
  let host = null; let shadow = null; let panel = null; let fab = null; let lastRecords = [];

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .fab { position: fixed; right: 18px; bottom: 18px; width: 48px; height: 48px; border-radius: 50%; border: 0; cursor: pointer;
      background: #0f766e; color: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.25); display: flex; align-items: center; justify-content: center;
      transition: transform .15s ease, background .15s ease; }
    .fab:hover { transform: scale(1.06); background: #115e59; }
    .fab[disabled] { opacity: .7; cursor: progress; }
    .fab svg { width: 22px; height: 22px; }
    .fab .dismiss { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; background: #334155; color: #fff;
      font-size: 11px; line-height: 18px; text-align: center; display: none; }
    .fab:hover .dismiss { display: block; }
    .panel { position: fixed; right: 18px; bottom: 76px; width: 340px; max-height: min(70vh, 560px); display: flex; flex-direction: column;
      background: #fff; color: #0f172a; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.28); overflow: hidden; font-size: 13px; line-height: 1.35; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0f766e; color: #fff; }
    .hd b { font-size: 13px; } .hd .site { opacity: .85; font-size: 12px; } .hd .x { margin-left: auto; background: transparent; border: 0; color: #fff; font-size: 18px; cursor: pointer; }
    .stats { display: flex; gap: 6px; padding: 10px 12px 6px; flex-wrap: wrap; }
    .chip { padding: 3px 8px; border-radius: 999px; font-size: 12px; background: #f1f5f9; }
    .chip.ok { background: #dcfce7; color: #166534; } .chip.warn { background: #fef3c7; color: #92400e; } .chip.bad { background: #fee2e2; color: #991b1b; }
    .msg { padding: 8px 12px; color: #334155; }
    .list { overflow: auto; padding: 0 6px 6px; }
    .item { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 7px 6px; border-radius: 8px; cursor: pointer; color: inherit; }
    .item:hover { background: #f8fafc; }
    .item .l { font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item .r { color: #64748b; font-size: 12px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .ft { display: flex; gap: 6px; padding: 8px 12px 12px; border-top: 1px solid #e2e8f0; }
    .btn { flex: 1; padding: 7px 8px; border-radius: 8px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-size: 12px; color: #0f172a; }
    .btn.primary { background: #0f766e; color: #fff; border-color: #0f766e; }
    .note { padding: 0 12px 8px; color: #64748b; font-size: 11.5px; }
    @media (prefers-color-scheme: dark) {
      .panel { background: #0f172a; color: #e2e8f0; } .chip { background: #1e293b; color: #cbd5e1; }
      .item:hover { background: #1e293b; } .btn { background: #1e293b; color: #e2e8f0; border-color: #334155; } .ft { border-color: #1e293b; } .msg { color: #cbd5e1; }
    }
  `;

  const BOLT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/></svg>';

  function ensureHost() {
    if (host && host.isConnected) return shadow;
    host = document.createElement('gaf-autofill-root');
    host.setAttribute(D.UI_ATTR, '');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0; width: 0; height: 0;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    return shadow;
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && n.appendChild(c));
    return n;
  }

  function sendToBackground(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve(null); else resolve(res);
        });
      } catch (_) { resolve(null); }
    });
  }

  async function triggerFill() {
    if (fab) fab.setAttribute('disabled', '');
    try {
      // Ask the service worker to fill every frame of the tab (forms often live in iframes); fall back to this frame.
      const res = await sendToBackground({ type: 'GAF_FILL_TAB' });
      if (!res) await GAF.engine.run({ trigger: 'manual' });
    } finally {
      if (fab) fab.removeAttribute('disabled');
    }
  }

  function showFab() {
    const root = ensureHost();
    if (fab && fab.isConnected) return;
    fab = el('button', { class: 'fab', title: 'Autofill this application (Alt+Shift+F)', 'aria-label': 'Autofill application', html: BOLT });
    const dismiss = el('span', { class: 'dismiss', text: '\u00d7', title: 'Hide for this page' });
    dismiss.addEventListener('click', (e) => { e.stopPropagation(); hideFab(); });
    fab.appendChild(dismiss);
    fab.addEventListener('click', triggerFill);
    root.appendChild(fab);
  }

  function hideFab() {
    if (fab) fab.remove();
    fab = null;
  }

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
  }

  function markTarget(rec) {
    const f = rec.field;
    if (!f) return null;
    if (f.markEl) return f.markEl;
    const members = f.members && f.members.length > 1 ? f.members : null;
    if (members) {
      let n = members[0];
      for (let i = 0; i < 8 && n; i++) {
        n = D.parentComposed(n);
        if (n && members.every((m) => n.contains(m))) return n;
      }
      return D.parentComposed(members[0]);
    }
    let e = f.el;
    if (!e) return null;
    if (!e.isConnected && e.id) {
      // React may replace the node after committing a value (Workday text fields); find its successor
      const again = document.querySelectorAll(e.tagName.toLowerCase() + '[id="' + e.id.replace(/"/g, '\\"') + '"]');
      if (again.length) e = again[0];
    }
    const type = (e.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return (e.labels && e.labels[0]) || D.parentComposed(e);
    if (type === 'file') return D.closestComposed(e, '[class*="upload" i], [class*="drop" i], [class*="file" i]') || D.parentComposed(e);
    try {
      const r = e.getBoundingClientRect();
      if (!GAF.util.isTestEnv() && (r.width < 24 || r.height < 12)) {
        return D.closestComposed(e, '[class*="control" i], [class*="select" i], [class*="combobox" i]') || D.parentComposed(e);
      }
    } catch (_) { /* ignore */ }
    return e;
  }

  function mark(target, status) {
    if (!target || !target.style || !COLORS[status]) return;
    if (!marks.has(target)) marks.set(target, { outline: target.style.outline, offset: target.style.outlineOffset });
    target.style.outline = `2px ${status === 'skipped' ? 'dashed' : 'solid'} ${COLORS[status]}`;
    target.style.outlineOffset = '2px';
    target.setAttribute('data-gaf-status', status);
    if (status !== 'filled') {
      const clear = () => { unmark(target); target.removeEventListener('input', clear, true); target.removeEventListener('change', clear, true); };
      target.addEventListener('input', clear, true);
      target.addEventListener('change', clear, true);
    }
  }

  function unmark(target) {
    const prev = marks.get(target);
    if (!prev) return;
    target.style.outline = prev.outline;
    target.style.outlineOffset = prev.offset;
    target.removeAttribute('data-gaf-status');
    marks.delete(target);
  }

  function clearMarks() {
    Array.from(marks.keys()).forEach(unmark);
  }

  function highlight(records) {
    records.forEach((r) => {
      if (r.status === 'filled' || r.status === 'failed' || (r.status === 'skipped' && r.reason !== 'sensitive')) {
        mark(markTarget(r), r.status);
      }
    });
  }

  function focusRecord(rec) {
    const t = markTarget(rec) || (rec.field && rec.field.el);
    if (!t) return;
    try { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) { /* ignore */ }
    const focusable = rec.field && rec.field.el;
    setTimeout(() => { try { focusable.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }, 350);
    if (t.animate) t.animate([{ boxShadow: '0 0 0 6px rgba(217,119,6,.45)' }, { boxShadow: '0 0 0 0 rgba(217,119,6,0)' }], { duration: 900 });
  }

  function showReport(summary, records) {
    const root = ensureHost();
    closePanel();
    lastRecords = records || [];
    const c = summary.counts || {};
    const attentionRecs = lastRecords.filter((r) => r.status === 'skipped' || r.status === 'failed' || (r.required && (r.status === 'nodata' || r.status === 'unknown')));

    const head = el('div', { class: 'hd' }, [
      el('span', { html: BOLT, style: 'width:16px;height:16px;display:inline-flex' }),
      el('b', { text: 'Garry AutoFill' }),
      el('span', { class: 'site', text: '\u00b7 ' + (summary.adapter || '') }),
      el('button', { class: 'x', text: '\u00d7', title: 'Close', onclick: closePanel }),
    ]);

    let body;
    if (summary.error === 'empty-profile') {
      body = el('div', { class: 'msg', text: 'Your profile is empty. Open the profile page, fill in your details once, then come back and press Autofill.' });
    } else {
      body = el('div', {}, [
        summary.notice ? el('div', { class: 'msg', text: summary.notice }) : null,
        el('div', { class: 'stats' }, [
          el('span', { class: 'chip ok', text: `${c.filled || 0} filled` }),
          el('span', { class: 'chip warn', text: `${attentionRecs.filter((r) => r.status === 'skipped').length} for you` }),
          c.failed ? el('span', { class: 'chip bad', text: `${c.failed} failed` }) : null,
          c.kept ? el('span', { class: 'chip', text: `${c.kept} already set` }) : null,
        ]),
        attentionRecs.length
          ? el('div', { class: 'list' }, attentionRecs.map((r) => {
            const why = r.status === 'failed' ? REASONS.failed : (REASONS[r.reason] || REASONS[r.status] || r.reason);
            return el('button', { class: 'item', onclick: () => focusRecord(r) }, [
              el('span', { class: 'l' }, [el('span', { class: 'dot', style: `background:${r.status === 'failed' ? COLORS.failed : COLORS.skipped}` }), document.createTextNode(r.label)]),
              el('span', { class: 'r', text: why }),
            ]);
          }))
          : el('div', { class: 'msg', text: (c.filled ? 'Everything recognised is filled. ' : 'Nothing new to fill on this step. ') + 'Review the page before continuing.' }),
        el('div', { class: 'note', text: 'Nothing is submitted automatically \u2014 check the answers, then continue yourself.' }),
      ]);
    }

    const foot = el('div', { class: 'ft' }, [
      el('button', { class: 'btn primary', text: 'Fill again', onclick: () => { closePanel(); triggerFill(); } }),
      el('button', { class: 'btn', text: 'Clear marks', onclick: clearMarks }),
      el('button', { class: 'btn', text: 'Profile', onclick: () => sendToBackground({ type: 'GAF_OPEN_OPTIONS' }) }),
    ]);

    panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': 'Garry AutoFill results' }, [head, body, foot]);
    root.appendChild(panel);
  }

  GAF.ui = { showFab, hideFab, showReport, closePanel, highlight, clearMarks, markTarget, triggerFill };
})();
