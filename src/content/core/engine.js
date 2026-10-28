/*
 * Garry AutoFill - the fill engine: detect adapter -> collect -> classify -> resolve -> fill (multi-pass) -> report.
 *
 * Adapter contract (all hooks optional except id/name/match):
 *   id, name
 *   match({ url, host, path, doc }) -> bool
 *   autoFill: bool                  auto-fill when fields appear (default true for site adapters, false for generic)
 *   exclude(el, ctx) -> bool         ignore an element during collection
 *   prepare(ctx)                     before the first pass (e.g. click "Add work experience")
 *   collect(fields, ctx) -> fields   add/replace/remove descriptors after generic collection
 *   classify(field, ctx) -> classification | null   (null = use generic classifier)
 *   resolve(key, field, ctx) -> answer | null | undefined   (undefined = use generic resolver)
 *   isEmpty(field, ctx) -> bool | undefined
 *   fill(field, answer, ctx) -> Promise<bool | undefined>   (undefined = use generic setter)
 *   afterPass(ctx, passIndex), afterFill(ctx)
 *   passDelay (ms), afterUploadDelay (ms)
 *
 * The engine never clicks submit/next buttons. See setters.js safeClick/withSubmitGuard.
 */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.engine) return;
  const { sleep, normalize } = GAF.util;

  const state = {
    running: null,
    handled: new WeakMap(), // element -> last status (auto mode skips these)
    uploaded: new Set(), // "<key>@<path>" uploaded during this page lifetime
    lastSummary: null,
    lastReport: [],
    observer: null,
    autoEnabled: false,
  };

  const GENERIC = {
    id: 'generic',
    name: 'Generic form',
    autoFill: false,
    match: () => true,
  };

  function detectAdapter(doc, loc) {
    const d = doc || document;
    const l = loc || location;
    const info = { url: l.href, host: l.hostname, path: l.pathname, doc: d };
    for (const a of GAF.adapters) {
      if (a.id === 'generic') continue;
      try { if (a.match(info)) return a; } catch (e) { GAF.util.log('adapter match error', a.id, e); }
    }
    return GAF.adapters.find((a) => a.id === 'generic') || GENERIC;
  }

  function hasProfileData(p) {
    return !!(p && (p.firstName || p.lastName || p.email || p.phone));
  }

  function shortLabel(f) {
    const t = (f.question || f.label || '').trim() || f.attrs || f.kind;
    return t.length > 110 ? t.slice(0, 107) + '\u2026' : t;
  }

  function assignIndices(fields) {
    const counters = {};
    for (const f of fields) {
      const c = f.classification;
      if (!c || !c.key) continue;
      const m = /^(exp|edu)\./.exec(c.key);
      if (!m) continue;
      if (typeof f.index === 'number') continue;
      const sec = (f.section || [])[0] || '';
      const n = /(\d+)\s*\)?\s*$/.exec(sec);
      if (n && (GAF.classifier.EXP_SECTION.test(normalize(sec)) || GAF.classifier.EDU_SECTION.test(normalize(sec)))) {
        f.index = Math.max(0, parseInt(n[1], 10) - 1);
        continue;
      }
      counters[c.key] = counters[c.key] == null ? 0 : counters[c.key] + 1;
      f.index = counters[c.key];
    }
  }

  function fillPriority(a, b) {
    const pa = priorityOf(a); const pb = priorityOf(b);
    return pa !== pb ? pa - pb : a.order - b.order;
  }

  function priorityOf(f) {
    const k = f.classification && f.classification.key;
    if (f.kind === 'file' && k === 'resume') return 0; // resume first: some ATS parse it and prefill the page
    if (k === 'country') return 1; // country changes which state/phone fields render
    return 2;
  }

  function fileAlreadyAttached(f, ctx) {
    const names = [ctx.files && ctx.files.resume, ctx.files && ctx.files.coverLetter].filter(Boolean).map((x) => normalize(x.name));
    if (!names.length) return false;
    let n = f.el;
    for (let i = 0; i < 5 && n; i++) {
      n = GAF.dom.parentComposed(n);
      if (!n || n.tagName === 'FORM' || n.tagName === 'BODY') break;
      const t = normalize(GAF.dom.textOf(n));
      if (t.length > 2000) break;
      if (names.some((nm) => nm && t.includes(nm))) return true;
    }
    return false;
  }

  function isEmptyField(f, ctx) {
    const a = ctx.adapter;
    if (a && typeof a.isEmpty === 'function') {
      const r = a.isEmpty(f, ctx);
      if (typeof r === 'boolean') return r;
    }
    if (f.kind === 'file' && fileAlreadyAttached(f, ctx)) return false;
    return GAF.fields.isEmpty(f);
  }

  function checkboxWant(f, value, key) {
    const k = GAF.options.KEY_CATEGORY[key];
    if (k === 'yesno' || key === 'custom') {
      const cls = GAF.options.classifyYesNo(String(value));
      if (cls === 'yes') {
        // "No, I don't require sponsorship" style checkbox labels
        const lbl = GAF.options.classifyYesNo(f.label || '');
        return lbl === 'no' ? false : true;
      }
      if (cls === 'no') {
        const lbl = GAF.options.classifyYesNo(f.label || '');
        return lbl === 'no' ? true : false;
      }
      return null;
    }
    // option-style checkbox ("Asian", "Male"): tick when it matches the answer
    return GAF.options.pick([f.label], value, key) === 0;
  }

  async function defaultFill(f, ans, ctx) {
    const S = GAF.set;
    const key = f.classification.key;
    const v = ans.value;
    const pickCtx = { country: ctx.profile.country };
    switch (f.kind) {
      case 'text':
      case 'textarea':
      case 'date':
        if (ans.file) return false;
        return S.setText(f.el, String(v));
      case 'select': {
        const opts = Array.from(f.el.options).map((o) => GAF.util.cleanLabel(o.textContent || o.label || ''));
        let idx = GAF.options.pick(opts, v, key, pickCtx);
        if (idx < 0) {
          const values = Array.from(f.el.options).map((o) => o.value);
          idx = GAF.options.pick(values, v, key, pickCtx);
        }
        if (idx < 0) return false;
        return S.setSelect(f.el, idx);
      }
      case 'radio':
      case 'ariaRadio': {
        const idx = GAF.options.pick(f.options, v, key, pickCtx);
        if (idx < 0) return false;
        return f.kind === 'radio' ? S.setChecked(f.members[idx], true) : S.setAriaChecked(f.members[idx], true);
      }
      case 'checkbox':
      case 'ariaCheckbox': {
        const want = checkboxWant(f, v, key);
        if (want == null) return false;
        if (!want) return f.kind === 'checkbox' ? (f.el.checked ? S.setChecked(f.el, false) : 'unchanged') : S.setAriaChecked(f.el, false);
        return f.kind === 'checkbox' ? S.setChecked(f.el, true) : S.setAriaChecked(f.el, true);
      }
      case 'checkboxGroup': {
        const idxs = GAF.options.pickMany(f.options, v, key);
        if (!idxs.length) return false;
        let ok = true;
        for (const i of idxs) ok = S.setChecked(f.members[i], true) && ok;
        return ok;
      }
      case 'file':
        return S.setFile(f.el, v);
      case 'combobox': {
        const choose = (texts) => GAF.options.pick(texts, v, key, pickCtx);
        const isInput = f.el.tagName === 'INPUT';
        const query = String(ans.query || (isInput ? v : ''));
        const typeaheadKeys = ['location', 'city', 'exp.location', 'edu.school', 'currentCompany', 'exp.company'];
        return S.setCombobox(f.el, choose, { query, allowFirstResult: isInput && typeaheadKeys.includes(key) });
      }
      default:
        return false;
    }
  }

  async function fillOne(f, ctx) {
    const a = ctx.adapter;
    const cls = f.classification || {};
    const rec = { label: shortLabel(f), key: cls.key || null, kind: f.kind, status: '', reason: '', required: !!f.required, field: f };
    if (cls.skip) {
      rec.status = cls.skip === 'unknown' ? 'unknown' : 'skipped';
      rec.reason = cls.skip;
      rec.detail = cls.reason;
      return rec;
    }
    if (!ctx.settings.overwriteExisting && !isEmptyField(f, ctx)) { rec.status = 'kept'; return rec; }
    if (ctx.settings.overwriteExisting && f.kind === 'file' && !isEmptyField(f, ctx)) { rec.status = 'kept'; return rec; }

    let ans;
    if (a && typeof a.resolve === 'function') ans = a.resolve(cls.key, f, ctx);
    if (ans === undefined) ans = GAF.answers.resolve(cls.key, f, ctx);
    if (!ans) { rec.status = 'nodata'; return rec; }
    if (ans.file) {
      const upKey = cls.key + '@' + location.pathname;
      if (ctx.settings.uploadResume === false) { rec.status = 'nodata'; return rec; }
      if (ctx.trigger === 'auto' && state.uploaded.has(upKey)) { rec.status = 'kept'; return rec; }
    }

    let ok;
    try {
      if (a && typeof a.fill === 'function') ok = await a.fill(f, ans, ctx);
      if (ok === undefined) ok = await defaultFill(f, ans, ctx);
    } catch (e) {
      ok = false;
      rec.error = String((e && e.message) || e);
      GAF.util.log('fill error', rec.label, e);
    }
    if (ok === 'unchanged') { rec.status = 'kept'; return rec; }
    rec.status = ok ? 'filled' : 'failed';
    if (!ok) rec.reason = 'could not set value';
    if (ok && ans.file) state.uploaded.add(cls.key + '@' + location.pathname);
    return rec;
  }

  function collectAll(ctx) {
    let fields = GAF.fields.collect(ctx);
    const a = ctx.adapter;
    if (a && typeof a.collect === 'function') fields = a.collect(fields, ctx) || fields;
    for (const f of fields) {
      let c = null;
      if (a && typeof a.classify === 'function') c = a.classify(f, ctx);
      f.classification = c || GAF.classifier.classify(f, ctx);
    }
    assignIndices(fields);
    return fields;
  }

  function summarize(ctx, ms) {
    const counts = { filled: 0, skipped: 0, failed: 0, nodata: 0, kept: 0, unknown: 0 };
    ctx.report.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const attention = ctx.report
      .filter((r) => r.status === 'skipped' || r.status === 'failed' || (r.required && (r.status === 'nodata' || r.status === 'unknown')))
      .map((r) => ({ label: r.label, status: r.status, reason: r.reason || r.status, key: r.key }));
    return {
      adapter: ctx.adapter ? ctx.adapter.name : 'Generic form',
      adapterId: ctx.adapter ? ctx.adapter.id : 'generic',
      url: location.href,
      trigger: ctx.trigger,
      counts,
      attention,
      filled: ctx.report.filter((r) => r.status === 'filled').map((r) => ({ label: r.label, key: r.key })),
      ms,
      error: ctx.error || null,
      notice: typeof ctx.abort === 'string' ? ctx.abort : null,
    };
  }

  /**
   * Fill the current document.
   * @param {{trigger?: 'manual'|'auto'|'message'}} opts
   */
  async function run(opts) {
    const o = opts || {};
    if (state.running) return state.running;
    state.running = (async () => {
      const t0 = Date.now();
      const { profile, settings, files } = await globalThis.GAF_SHARED.loadAll();
      GAF.debug = !!settings.debug;
      const adapter = detectAdapter();
      const ctx = { profile, settings, files, adapter, trigger: o.trigger || 'manual', report: [], state, root: document };

      if (!hasProfileData(profile)) {
        ctx.error = 'empty-profile';
        const s = summarize(ctx, 0);
        if (ctx.trigger !== 'auto' && GAF.ui) GAF.ui.showReport(s, []);
        return s;
      }

      await GAF.set.withSubmitGuard(async () => {
        if (adapter.prepare) {
          try { await adapter.prepare(ctx); } catch (e) { GAF.util.log('prepare failed', e); }
        }
        const seenThisRun = new Set();
        for (let pass = 0; pass < 4; pass++) {
          const fields = collectAll(ctx);
          const todo = fields.filter((f) => !seenThisRun.has(f.el) && !(ctx.trigger === 'auto' && state.handled.has(f.el)));
          if (!todo.length) break;
          todo.sort(fillPriority);
          let changed = 0;
          for (const f of todo) {
            if (!f.el.isConnected) continue;
            seenThisRun.add(f.el);
            const rec = await fillOne(f, ctx);
            ctx.report.push(rec);
            (f.members || [f.el]).forEach((m) => state.handled.set(m, rec.status));
            if (rec.status === 'filled') {
              changed++;
              if (rec.key === 'resume') await sleep(adapter.afterUploadDelay != null ? adapter.afterUploadDelay : 1500);
              else if (f.kind !== 'text' && f.kind !== 'textarea') await sleep(adapter.stepDelay != null ? adapter.stepDelay : 80);
            }
            // an adapter can stop the run, e.g. iCIMS reloads the page to parse an uploaded resume
            if (ctx.abort) break;
          }
          if (ctx.abort) break;
          if (adapter.afterPass) {
            try { await adapter.afterPass(ctx, pass); } catch (e) { GAF.util.log('afterPass failed', e); }
          }
          if (!changed) break;
          await sleep(adapter.passDelay != null ? adapter.passDelay : 500);
        }
        if (adapter.afterFill) {
          try { await adapter.afterFill(ctx); } catch (e) { GAF.util.log('afterFill failed', e); }
        }
      });

      const summary = summarize(ctx, Date.now() - t0);
      state.lastSummary = summary;
      state.lastReport = ctx.report;
      const meaningful = ctx.report.some((r) => r.status === 'filled' || r.status === 'skipped' || r.status === 'failed');
      if (GAF.ui) {
        if (settings.highlightFields !== false) GAF.ui.highlight(ctx.report);
        if ((ctx.trigger !== 'auto' && ctx.report.length) || (ctx.trigger === 'auto' && summary.counts.filled > 0)) GAF.ui.showReport(summary, ctx.report);
        else if (ctx.trigger !== 'auto' && !meaningful && window === window.top) GAF.ui.showReport(summary, ctx.report);
      }
      return summary;
    })();
    try {
      return await state.running;
    } finally {
      state.running = null;
    }
  }

  function hasUnhandledCandidates() {
    const els = GAF.dom.deepQueryAll('input:not([type="hidden"]), select, textarea, button[aria-haspopup="listbox"], [role="combobox"]');
    // isInteractable, not isVisible: upload widgets hide the real <input type=file> behind a drop zone
    return els.some((el) => !state.handled.has(el) && GAF.dom.isInteractable(el));
  }

  /** Auto-fill whenever new form fields appear (wizard steps, conditional questions). */
  function watch() {
    if (state.observer || typeof MutationObserver === 'undefined') return;
    state.autoEnabled = true;
    const trigger = GAF.util.debounce(async () => {
      if (!state.autoEnabled) return;
      if (state.running) { trigger(); return; }
      if (!hasUnhandledCandidates()) return;
      try { await run({ trigger: 'auto' }); } catch (e) { GAF.util.log('auto run failed', e); }
    }, 900);
    state.observer = new MutationObserver((muts) => {
      if (!state.autoEnabled) return;
      for (const m of muts) {
        const t = m.target;
        if (t && t.nodeType === 1 && t.closest && t.closest('[' + GAF.dom.UI_ATTR + ']')) continue;
        if (m.addedNodes && m.addedNodes.length) { trigger(); return; }
      }
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    trigger();
  }

  function unwatch() {
    state.autoEnabled = false;
    if (state.observer) state.observer.disconnect();
    state.observer = null;
  }

  function status() {
    const adapter = detectAdapter();
    let fieldCount = 0;
    try { fieldCount = GAF.fields.collect({ adapter, root: document }).length; } catch (_) { fieldCount = 0; }
    return { adapter: adapter.name, adapterId: adapter.id, fieldCount, url: location.href, last: state.lastSummary };
  }

  GAF.registerAdapter(GENERIC);
  GAF.engine = { run, watch, unwatch, status, detectAdapter, collectAll, fillOne, defaultFill, isEmptyField, assignIndices, state, shortLabel, checkboxWant };
})();
