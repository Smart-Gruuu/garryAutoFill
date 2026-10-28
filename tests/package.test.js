/* Static checks that mirror what Chrome enforces when loading the unpacked extension. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { bundleFiles, ROOT } = require('./harness');

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function referencedFiles() {
  const files = new Set();
  const add = (p) => p && files.add(p.replace(/^\//, ''));
  add(manifest.background.service_worker);
  add(manifest.action.default_popup);
  add(manifest.options_ui.page);
  Object.values(manifest.icons).forEach(add);
  Object.values(manifest.action.default_icon).forEach(add);
  manifest.content_scripts.forEach((cs) => (cs.js || []).forEach(add));
  bundleFiles().forEach(add);
  return Array.from(files);
}

function allSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return allSourceFiles(p);
    return /\.(js|html|css|json)$/.test(d.name) ? [p] : [];
  });
}

test('every file referenced by the manifest and the injection bundle exists', () => {
  const missing = referencedFiles().filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepStrictEqual(missing, []);
});

test('extension scripts are plain ASCII (Chrome rejects noncharacters as "not UTF-8 encoded")', () => {
  const offenders = [];
  for (const file of allSourceFiles(path.join(ROOT, 'src')).concat([path.join(ROOT, 'manifest.json')])) {
    const buf = fs.readFileSync(file);
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) offenders.push(path.relative(ROOT, file) + ' (BOM)');
    if (!file.endsWith('.js')) {
      try { new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { offenders.push(path.relative(ROOT, file) + ' (invalid UTF-8)'); }
      const text = buf.toString('utf8');
      if (/[﷐-﷯￾￿]/.test(text)) offenders.push(path.relative(ROOT, file) + ' (noncharacter)');
      continue;
    }
    const idx = buf.findIndex((b) => b > 127);
    if (idx >= 0) {
      const line = buf.slice(0, idx).toString('utf8').split('\n').length;
      offenders.push(`${path.relative(ROOT, file)}:${line}`);
    }
  }
  assert.deepStrictEqual(offenders, [], 'run: node tools/ascii-escape.js');
});

test('every injected script parses as a classic script', () => {
  for (const rel of bundleFiles().concat(['src/content/loader.js', manifest.background.service_worker, 'src/content/bundle-files.js'])) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: rel }), rel);
  }
});

test('injected bundle files have no top-level let/const (re-injection would throw)', () => {
  for (const rel of bundleFiles()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const bad = src.split('\n').filter((l) => /^(const|let|class)\s/.test(l));
    assert.deepStrictEqual(bad, [], rel);
  }
});

test('manifest is MV3 with the permissions the service worker uses', () => {
  assert.strictEqual(manifest.manifest_version, 3);
  ['storage', 'scripting', 'webNavigation', 'contextMenus'].forEach((p) => assert.ok(manifest.permissions.includes(p), p));
  assert.ok(manifest.host_permissions.includes('<all_urls>'));
  assert.ok(manifest.content_scripts[0].all_frames);
});
