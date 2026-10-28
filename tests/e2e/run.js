/*
 * End-to-end test in a real Chrome (Chrome for Testing via puppeteer) with the unpacked extension loaded.
 * ATS hostnames are mapped to a local fixture server with --host-resolver-rules, so the real loader,
 * service-worker injection, auto-fill watcher and chrome.storage paths are exercised.
 *
 *   npm run e2e            (HEADFUL=1 npm run e2e to watch)
 */
const https = require('https');
const os = require('os');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const { profile, files } = require('../fixtures/profile');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  { host: /myworkdayjobs\.com$/, path: /autofillWithResume/, file: 'workday-autofill-resume.html' },
  { host: /myworkdayjobs\.com$/, path: /applyManually/, file: 'workday-wizard.html' },
  { host: /^careers\.example\.test$/, path: /./, file: 'generic-form.html' },
  { host: /^careers-frontdoor\.icims\.com$/, path: /in_iframe=1/, file: 'icims-profile.html' },
  { host: /^careers-frontdoor\.icims\.com$/, path: /./, file: null, wrapper: true },
];
const icimsPosts = [];

/** Throwaway self-signed certificate (ATS hosts such as myworkdayjobs.com are HTTPS-only in Chrome). */
function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaf-e2e-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=gaf-e2e'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

function startServer() {
  return new Promise((resolve) => {
    const server = https.createServer(selfSignedCert(), (req, res) => {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      const route = ROUTES.find((r) => r.host.test(host) && r.path.test(req.url));
      if (!route) { res.writeHead(404); res.end('no fixture for ' + host + req.url); return; }
      const send = () => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (route.wrapper) {
          // iCIMS portal page: the application lives in #icims_content_iframe (?in_iframe=1)
          const src = req.url + (req.url.includes('?') ? '&' : '?') + 'in_iframe=1';
          res.end('<!doctype html><title>Careers</title><h1>Software Engineer L4 (Remote)</h1><iframe id="icims_content_iframe" src="' + src.replace(/"/g, '&quot;') + '" style="width:100%;height:2600px;border:0"></iframe>');
        } else {
          res.end(fs.readFileSync(path.join(FIXTURES, route.file)));
        }
      };
      if (req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => { icimsPosts.push({ url: req.url, body: Buffer.concat(chunks).toString('latin1') }); send(); });
      } else send();
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${String((e && e.stack) || e).split('\n').slice(0, 5).join('\n      ')}`);
  }
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    headless: !process.env.HEADFUL,
    pipe: true,
    acceptInsecureCerts: true,
    enableExtensions: [ROOT],
    args: [
      `--host-resolver-rules=MAP *.myworkdayjobs.com 127.0.0.1:${port},MAP careers.example.test 127.0.0.1:${port},MAP careers-frontdoor.icims.com 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });

  const swLogs = [];
  let worker;
  let extensionId;
  console.log('e2e (Chrome for Testing ' + (await browser.version()) + ')');

  try {
    await step('extension service worker starts', async () => {
      const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background/service-worker.js'), { timeout: 20000 });
      extensionId = new URL(target.url()).host;
      worker = await target.worker();
      worker.on('console', (m) => swLogs.push(m.text()));
      await worker.evaluate((store) => new Promise((r) => chrome.storage.local.set(store, r)), {
        gaf_profile: profile,
        gaf_files: files,
        gaf_settings: { autoFillOnAtsSites: true, showFloatingButton: true, overwriteExisting: false, highlightFields: true, fillEEO: true, addMissingEntries: true, uploadResume: true, debug: false },
      });
    });

    await step('Workday "Autofill with Resume": resume uploads automatically (no click)', async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('https://bonterra.wd1.myworkdayjobs.com/en-US/bonterratech/job/Remote/Senior-Software-Engineer_R2026-0310/apply/autofillWithResume?jr_id=1', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__uploaded === 1, { timeout: 25000 });
      await sleep(2500);
      assert.strictEqual(await page.evaluate(() => window.__uploaded), 1, 'uploaded exactly once');
      assert.strictEqual(await page.evaluate(() => window.__nextClicks), 0);
      assert.ok(await page.evaluate(() => !!document.querySelector('gaf-autofill-root')), 'floating button / panel rendered');
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await step('Workday wizard: auto-fill completes every step without clicking Next', async () => {
      const page = await browser.newPage();
      await page.goto('https://bonterra.wd1.myworkdayjobs.com/en-US/bonterratech/job/Remote/Senior-Software-Engineer_R2026-0310/apply/applyManually', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const s = window.__state || {};
        return s['personalInfoUS--veteranStatus'] && window.__uploads === 1 && (s['skills--skills'] || []).length >= 5 &&
          Object.keys(s).some((k) => /^education-\d+--lastYearAttended$/.test(k));
      }, { timeout: 120000, polling: 500 });
      await sleep(3000);
      const got = await page.evaluate(() => {
        const v = (id) => { const e = document.querySelector('[id="' + id + '"]'); return e ? e.value : null; };
        const exp = Array.from(document.querySelectorAll('[data-fkit-id^="workExperience-"][data-fkit-id$="--null"]')).map((p) => p.getAttribute('data-fkit-id').replace('--null', ''));
        return {
          first: v('name--legalName--firstName'), email: v('emailAddress--emailAddress'), phone: v('phoneNumber--phoneNumber'),
          state: window.__state['address--countryRegion'], phoneType: window.__state['phoneNumber--phoneType'], source: window.__state['source--source'],
          prevWorker: (document.querySelector('input[name="candidateIsPreviousWorker"]:checked') || {}).value,
          expCount: exp.length, exp0Title: v(exp[0] + '--jobTitle'), exp1Company: v(exp[1] + '--companyName'), exp0Start: window.__state[exp[0] + '--startDate'],
          q1: window.__state['primaryQuestionnaire--q1'], q2: window.__state['primaryQuestionnaire--q2'], essay: v('primaryQuestionnaire--q3'),
          terms: document.querySelector('[id="termsAndConditions--acceptTermsAndAgreements"]').checked,
          sigName: v('selfIdentifiedDisabilityData--name'), next: window.__nextClicks, uploads: window.__uploads,
        };
      });
      assert.deepStrictEqual(got, {
        first: 'Jordan', email: 'jordan.rivera@example.com', phone: '4155550134', state: 'California', phoneType: 'Mobile', source: 'LinkedIn',
        prevWorker: 'false', expCount: 2, exp0Title: 'Senior Software Engineer', exp1Company: 'Globex', exp0Start: '03/2021',
        q1: 'Yes', q2: 'No', essay: '', terms: false, sigName: '', next: 0, uploads: 1,
      });
      await page.close();
    });

    await step('generic site: manual fill through the service worker (button / shortcut path)', async () => {
      const page = await browser.newPage();
      await page.goto('https://careers.example.test/jobs/123/apply', { waitUntil: 'domcontentloaded' });
      await sleep(1500);
      const res = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ url: '*://careers.example.test/*' });
        return fillTab(tab.id, 'manual'); // eslint-disable-line no-undef
      });
      assert.ok(res && res.ok, JSON.stringify(res));
      assert.ok(res.counts.filled >= 20, JSON.stringify(res.counts));
      const vals = await page.evaluate(() => ({ fn: document.getElementById('fn').value, st: document.getElementById('st').value, why: document.getElementById('why').value, resume: document.getElementById('resume').files.length, submitted: window.__submitted }));
      assert.deepStrictEqual(vals, { fn: 'Jordan', st: 'CA', why: '', resume: 1, submitted: 0 });
      await page.close();
    });

    await step('iCIMS (iframe portal): resume upload reloads the frame, then the profile fills itself', async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('https://careers-frontdoor.icims.com/jobs/4163/software-engineer-l4-%28remote%29/candidate?from=login', { waitUntil: 'domcontentloaded' });
      const frameFor = () => page.frames().find((fr) => /in_iframe=1/.test(fr.url()));
      // 1) auto-fill attaches the resume -> iCIMS onchange submits the form -> POST with the file
      const deadline = Date.now() + 30000;
      while (!icimsPosts.length && Date.now() < deadline) await sleep(200);
      assert.strictEqual(icimsPosts.length, 1, 'one resume-parse POST');
      assert.ok(/uploadResume=1/.test(icimsPosts[0].url), icimsPosts[0].url);
      assert.ok(icimsPosts[0].body.includes('filename="Jordan_Rivera_Resume.pdf"'), 'resume file included in the POST');
      // 2) after the reload the rest fills automatically
      let frame;
      await (async () => {
        const end = Date.now() + 60000;
        for (;;) {
          frame = frameFor();
          try {
            if (frame && /uploadResume=1/.test(frame.url()) && await frame.evaluate(() => {
              const t = (id) => (document.getElementById(id + '_fakeSelected_icimsDropdown') || {}).textContent;
              return document.getElementById('PersonProfileFields.FirstName').value === 'Jordan' && t('-1_PersonProfileFields.AddressState') === 'California' && t('rcf3180') === 'Yes';
            })) return;
          } catch (_) { /* frame navigating */ }
          if (Date.now() > end) throw new Error('profile did not fill after reload');
          await sleep(300);
        }
      })();
      await sleep(3000);
      const got = await frame.evaluate(() => {
        const v = (id) => document.getElementById(id).value;
        const t = (id) => document.getElementById(id + '_fakeSelected_icimsDropdown').textContent;
        const sel = (id) => { const s = document.getElementById(id); return s.options[s.selectedIndex].textContent; };
        return {
          last: v('PersonProfileFields.LastName'), email: v('PersonProfileFields.Email'), phoneType: sel('-1_PersonProfileFields.PhoneType'),
          country: t('-1_PersonProfileFields.AddressCountry'), state: t('-1_PersonProfileFields.AddressState'), prev: t('rcf2044'), source: sel('rcf3048'),
          salary: v('rcf2035'), login: v('PersonProfileFields.Login'), pw: v('PersonProfileFields.Password'), refFirst: v('-1_PersonProfileFields.rcf3281'),
          essay: v('rcf3100'), submitClicks: window.__submitClicks, submitEvents: window.__submitEvents,
        };
      });
      assert.deepStrictEqual(got, {
        last: 'Rivera', email: 'jordan.rivera@example.com', phoneType: 'Cell Phone', country: 'United States', state: 'California', prev: 'No', source: 'LinkedIn',
        salary: '185000', login: '', pw: '', refFirst: '', essay: '', submitClicks: 0, submitEvents: 0,
      });
      assert.strictEqual(icimsPosts.length, 1, 'no second upload after the reload');
      assert.deepStrictEqual(errors, []);
      await page.close();
    });

    await step('popup and options pages render without errors', async () => {
      for (const p of ['src/popup/popup.html', 'src/options/options.html']) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`chrome-extension://${extensionId}/${p}`, { waitUntil: 'load' });
        await sleep(800);
        if (p.includes('options')) {
          const first = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map((i) => i.value).includes('Jordan'));
          assert.ok(first, 'options page shows stored profile');
        }
        assert.deepStrictEqual(errors, [], p);
        await page.close();
      }
    });

    await step('service worker logged no injection failures', async () => {
      assert.deepStrictEqual(swLogs.filter((l) => /fail|error|isn't UTF-8/i.test(l)), []);
    });
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
