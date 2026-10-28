/* Garry AutoFill - namespace + small utilities. First file of the content bundle. */
(function () {
  'use strict';
  const GAF = (globalThis.GAF = globalThis.GAF || {});
  if (GAF.util) return;

  GAF.version = '1.0.0';
  GAF.adapters = GAF.adapters || [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Lower-case, accent-free, single-spaced text. */
  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** normalize() plus punctuation stripped - for comparing option texts. Keeps "+" for "+1" codes. */
  function simplify(s) {
    return normalize(s).replace(/'/g, '').replace(/[^a-z0-9+]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** "legalName--firstName" / "first_name" / "urls[LinkedIn]" -> "legal name first name" */
  function humanizeAttr(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[_\-\[\].:#/\\]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /** Visible-label cleanup: drop required markers and trailing colons, collapse whitespace. */
  function cleanLabel(s) {
    return String(s || '')
      .replace(/[\u00a0\s]+/g, ' ')
      .replace(/\((required|optional)\)/gi, ' ')
      .replace(/\b(required|this field is required\.?)\s*$/i, ' ')
      .replace(/[*\u2731]+/g, ' ')
      .replace(/\s*:\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function waitFor(fn, opts) {
    const { timeout = 3000, interval = 50 } = opts || {};
    const end = Date.now() + timeout;
    for (;;) {
      let v = null;
      try { v = fn(); } catch (_) { v = null; }
      if (v && !(Array.isArray(v) && v.length === 0)) return v;
      if (Date.now() >= end) return null;
      await sleep(interval);
    }
  }

  function debounce(fn, ms) {
    let t = null;
    const d = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
    d.cancel = () => clearTimeout(t);
    return d;
  }

  function isTestEnv() {
    return !!globalThis.__GAF_TEST__ || (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || ''));
  }

  function cssEscape(s) {
    if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(String(s));
    return String(s).replace(/^-?\d|[^a-zA-Z0-9_\-\u00a0-\uffff]/g, (c) => {
      if (/\d/.test(c) || c.length > 1) return c.replace(/\d/, (d) => '\\3' + d + ' ');
      return '\\' + c;
    });
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function log(...args) {
    if (GAF.debug) console.debug('[GarryAutoFill]', ...args);
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  GAF.util = { sleep, normalize, simplify, humanizeAttr, cleanLabel, waitFor, debounce, isTestEnv, cssEscape, escapeRegex, log, uniq };

  /** Adapters call this. Later registrations with the same id replace earlier ones. */
  GAF.registerAdapter = function registerAdapter(adapter) {
    if (!adapter || !adapter.id) throw new Error('adapter needs an id');
    const i = GAF.adapters.findIndex((a) => a.id === adapter.id);
    if (i >= 0) GAF.adapters.splice(i, 1, adapter); else GAF.adapters.push(adapter);
  };
})();
