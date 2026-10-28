/*
 * Test harness: loads the real content bundle into a jsdom window with a fixture page and a mocked chrome API.
 *
 *   const page = await loadPage({ html, url, profile, settings, files });
 *   const summary = await page.fill();              // GAF.engine.run({ trigger: 'manual' })
 *   page.$('#first_name').value
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function bundleFiles() {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/content/bundle-files.js'), 'utf8'), sandbox);
  return sandbox.GAF_BUNDLE;
}

function chromeMock(store) {
  const listeners = [];
  return {
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          [].concat(keys).forEach((k) => { if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); });
          setTimeout(() => cb(out), 0);
        },
        set(obj, cb) {
          Object.assign(store, JSON.parse(JSON.stringify(obj)));
          if (cb) setTimeout(cb, 0);
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      lastError: null,
      sendMessage(_msg, cb) { if (cb) setTimeout(() => cb(null), 0); },
      onMessage: { addListener() {} },
      getURL: (p) => 'chrome-extension://test/' + p,
    },
  };
}

function installPolyfills(w) {
  if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function () {};
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) w.CSS.escape = (s) => String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1');

  class FakeDataTransfer {
    constructor() {
      this._files = [];
      this.items = { add: (f) => { this._files.push(f); } };
      this.dropEffect = 'copy';
      this.effectAllowed = 'all';
      this.types = ['Files'];
    }
    get files() {
      const list = this._files.slice();
      list.item = (i) => list[i] || null;
      return list;
    }
  }
  w.DataTransfer = FakeDataTransfer;

  const filesDesc = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'files');
  Object.defineProperty(w.HTMLInputElement.prototype, 'files', {
    configurable: true,
    get() { return this.__gafFiles || (filesDesc && filesDesc.get ? filesDesc.get.call(this) : null); },
    set(v) { this.__gafFiles = v; },
  });
}

/**
 * @param {object} o
 * @param {string} o.html   page markup (inline <script>s run, so fixtures can emulate widgets)
 * @param {string} [o.url]
 * @param {object} [o.profile] defaults to tests/fixtures/profile.js
 * @param {object} [o.settings]
 * @param {object} [o.files]  defaults to a small fake resume
 */
async function loadPage(o) {
  const fixtures = require('./fixtures/profile');
  const profile = o.profile || fixtures.profile;
  const files = o.files === undefined ? fixtures.files : o.files;
  const settings = Object.assign({ autoFillOnAtsSites: false, showFloatingButton: false, highlightFields: true }, o.settings || {});
  const store = { gaf_profile: profile, gaf_settings: settings, gaf_files: files };

  const dom = new JSDOM(o.html, {
    url: o.url || 'https://example.com/apply',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.__GAF_TEST__ = true;
      w.__GAF_NO_BOOT__ = true;
      installPolyfills(w);
      w.chrome = chromeMock(store);
    },
  });
  const w = dom.window;
  // let inline scripts / DOMContentLoaded handlers settle
  await new Promise((r) => setTimeout(r, 10));
  for (const rel of bundleFiles()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    w.eval(src + '\n//# sourceURL=' + rel);
  }
  const page = {
    dom,
    window: w,
    document: w.document,
    GAF: w.GAF,
    store,
    $: (sel) => w.document.querySelector(sel),
    $$: (sel) => Array.from(w.document.querySelectorAll(sel)),
    fill: (opts) => w.GAF.engine.run(Object.assign({ trigger: 'manual' }, opts || {})),
    fields: () => w.GAF.engine.collectAll({ profile, settings: Object.assign({}, w.GAF_SHARED.DEFAULT_SETTINGS, settings), files, adapter: w.GAF.engine.detectAdapter(), root: w.document, report: [] }),
    close: () => w.close(),
  };
  return page;
}

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

module.exports = { loadPage, loadFixture, bundleFiles, ROOT };
