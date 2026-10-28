/*
 * Rewrites non-ASCII characters in extension JS files so Chrome's extension file loader always accepts them
 * (it rejects Unicode noncharacters such as U+FFFF with "It isn't UTF-8 encoded").
 *   - inside comments: replaced with a plain ASCII look-alike
 *   - everywhere else (strings, regex literals, templates): replaced with a \uXXXX escape
 * Usage: node tools/ascii-escape.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src'];
const COMMENT_ASCII = { '—': '-', '–': '-', '…': '...', '‘': "'", '’': "'", '“': '"', '”': '"', '·': '-', '×': 'x', '→': '->' };

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return jsFiles(p);
    return d.name.endsWith('.js') ? [p] : [];
  });
}

function escapeChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp <= 0xffff) return '\\u' + cp.toString(16).padStart(4, '0');
  const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
  const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
  return '\\u' + hi.toString(16) + '\\u' + lo.toString(16);
}

function inComment(line, idx, inBlock) {
  if (inBlock) return true;
  const before = line.slice(0, idx);
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) {
    // a block comment that closed earlier on this line means we're back in code
    const close = before.lastIndexOf('*/');
    const open = before.lastIndexOf('/*');
    if (close > open && close >= 0 && !trimmed.startsWith('//')) return false;
    return true;
  }
  const open = before.lastIndexOf('/*');
  if (open >= 0 && before.indexOf('*/', open) < 0) return true;
  return /(^|\s)\/\/\s/.test(before);
}

function convert(src) {
  let inBlock = false;
  let changed = 0;
  const out = src.split('\n').map((line) => {
    let res = '';
    const chars = Array.from(line);
    let pos = 0;
    for (const ch of chars) {
      const cp = ch.codePointAt(0);
      if (cp > 127) {
        changed++;
        res += inComment(line, pos, inBlock) ? (COMMENT_ASCII[ch] || '?') : escapeChar(ch);
      } else res += ch;
      pos += ch.length;
    }
    // track block comments spanning lines (ignores comment markers inside strings, good enough for this codebase)
    const opens = line.lastIndexOf('/*');
    const closes = line.lastIndexOf('*/');
    if (opens > closes) inBlock = true;
    else if (closes >= 0 && closes > opens) inBlock = false;
    return res;
  }).join('\n');
  return { out, changed };
}

const check = process.argv.includes('--check');
let bad = 0;
for (const dir of DIRS) {
  for (const file of jsFiles(path.join(ROOT, dir))) {
    const src = fs.readFileSync(file, 'utf8');
    const { out, changed } = convert(src);
    if (!changed) continue;
    bad++;
    if (check) console.log('non-ASCII:', path.relative(ROOT, file));
    else {
      fs.writeFileSync(file, out, 'utf8');
      console.log(`escaped ${changed} char(s) in ${path.relative(ROOT, file)}`);
    }
  }
}
if (check && bad) process.exit(1);
