/*
 * Minimal test runner. Usage:
 *   node tests/run.js            run all tests/**\/*.test.js
 *   node tests/run.js workday    only files whose path contains "workday"
 */
const fs = require('fs');
const path = require('path');

const tests = [];
let currentFile = '';
global.test = (name, fn) => tests.push({ name, fn, file: currentFile });

function findTests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'fixtures' ? [] : findTests(p);
    return d.name.endsWith('.test.js') ? [p] : [];
  });
}

(async () => {
  const filter = process.argv[2];
  const files = findTests(__dirname).sort().filter((f) => !filter || f.includes(filter));
  for (const f of files) {
    currentFile = path.relative(__dirname, f);
    require(f);
  }
  let pass = 0; let fail = 0;
  let lastFile = '';
  // silence noisy page console output from jsdom virtual consoles
  for (const t of tests) {
    if (t.file !== lastFile) { console.log('\n' + t.file); lastFile = t.file; }
    const start = Date.now();
    try {
      await Promise.race([
        t.fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 120s')), 120000)),
      ]);
      pass++;
      console.log(`  ✓ ${t.name} (${Date.now() - start}ms)`);
    } catch (e) {
      fail++;
      console.log(`  ✗ ${t.name}\n      ${String(e && e.stack || e).split('\n').slice(0, 6).join('\n      ')}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
