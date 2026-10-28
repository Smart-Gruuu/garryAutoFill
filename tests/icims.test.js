const assert = require('assert');
const { loadPage, loadFixture } = require('./harness');

const BASE = 'https://careers-frontdoor.icims.com/jobs/4163/software-engineer-l4-%28remote%29/candidate?from=login&in_iframe=1';

test('icims: detects the adapter on icims.com', async () => {
  const page = await loadPage({ html: loadFixture('icims-profile.html'), url: BASE });
  assert.strictEqual(page.GAF.engine.detectAdapter().id, 'icims');
});

test('icims: a password box inside the big profile form no longer blocks the whole form', async () => {
  const page = await loadPage({ html: loadFixture('icims-profile.html'), url: BASE + '&uploadResume=1' });
  const fields = page.fields();
  const ids = fields.map((f) => f.el.id);
  assert.ok(ids.includes('PersonProfileFields.FirstName'), ids.join(','));
  assert.ok(!ids.includes('PersonProfileFields.Password'), 'password is never collected');
});

test('icims: fresh profile - resume is attached first, iCIMS submits for parsing, run stops', async () => {
  const page = await loadPage({ html: loadFixture('icims-profile.html'), url: BASE });
  const s = await page.fill();
  assert.strictEqual(page.$('[id="PortalProfileFields.Resume_File"]').files.length, 1);
  assert.strictEqual(page.window.__formSubmits, 1, 'iCIMS onchange handler submitted the form for resume parsing');
  assert.ok(/uploadResume=1/.test(page.window.__submittedAction));
  assert.ok(s.notice && /reload/i.test(s.notice), JSON.stringify(s));
  assert.strictEqual(page.$('[id="PersonProfileFields.FirstName"]').value, '', 'run stopped before other fields (page is reloading)');
  assert.strictEqual(page.window.__submitClicks, 0);
});

let filled = null;
async function afterUpload() {
  if (!filled) {
    filled = (async () => {
      const page = await loadPage({ html: loadFixture('icims-profile.html'), url: BASE + '&uploadResume=1' });
      const summary = await page.fill();
      return { page, summary };
    })();
  }
  return filled;
}
const v = (page, id) => page.document.getElementById(id).value;

test('icims: after the parse reload - no second upload, no submit', async () => {
  const { page, summary } = await afterUpload();
  assert.strictEqual(page.window.__formSubmits, 0, JSON.stringify(summary.counts));
  assert.strictEqual(page.$('[id="PortalProfileFields.Resume_File"]').files.length, 0);
  assert.strictEqual(page.window.__submitEvents, 0);
  assert.strictEqual(page.window.__submitClicks, 0);
});

test('icims: standard profile fields, phone/address collections', async () => {
  const { page, summary } = await afterUpload();
  assert.strictEqual(v(page, 'PersonProfileFields.FirstName'), 'Jordan', JSON.stringify(summary.attention));
  assert.strictEqual(v(page, 'PersonProfileFields.MiddleName'), 'A');
  assert.strictEqual(v(page, 'PersonProfileFields.LastName'), 'Rivera');
  assert.strictEqual(v(page, 'PersonProfileFields.Email'), 'jordan.rivera@example.com');
  assert.strictEqual(v(page, 'rcf2095'), 'Jo');
  const phoneType = page.document.getElementById('-1_PersonProfileFields.PhoneType');
  assert.strictEqual(phoneType.options[phoneType.selectedIndex].textContent, 'Cell Phone');
  assert.strictEqual(v(page, '-1_PersonProfileFields.PhoneNumber'), '4155550134');
  const addrType = page.document.getElementById('-1_PersonProfileFields.AddressType');
  assert.strictEqual(addrType.options[addrType.selectedIndex].textContent, 'Home');
  assert.strictEqual(v(page, '-1_PersonProfileFields.AddressStreet1'), '500 Market St');
  assert.strictEqual(v(page, '-1_PersonProfileFields.AddressStreet2'), 'Apt 12');
  assert.strictEqual(v(page, '-1_PersonProfileFields.AddressCity'), 'San Francisco');
  assert.strictEqual(v(page, '-1_PersonProfileFields.AddressZip'), '94105');
});

test('icims: dropdown widget - country (beyond the first 25, via search), dependent state, yes/no lists', async () => {
  const { page } = await afterUpload();
  const shown = (id) => page.document.getElementById(id + '_fakeSelected_icimsDropdown').textContent;
  const native = (id) => { const s = page.document.getElementById(id); return s.options[s.selectedIndex] && s.options[s.selectedIndex].textContent; };
  assert.strictEqual(shown('-1_PersonProfileFields.AddressCountry'), 'United States');
  assert.strictEqual(native('-1_PersonProfileFields.AddressCountry'), 'United States');
  assert.strictEqual(shown('-1_PersonProfileFields.AddressState'), 'California');
  assert.strictEqual(native('-1_PersonProfileFields.AddressState'), 'California');
  assert.strictEqual(shown('rcf2044'), 'No');
  assert.strictEqual(shown('rcf3180'), 'Yes');
  assert.ok(page.window.__changes.includes('-1_PersonProfileFields.AddressCountry'), 'select onchange fired');
  assert.ok(/Make a Selection/.test(shown('rcf3077')), 'time zone not in profile - untouched');
  assert.strictEqual(page.$$('.dropdown-container:not(.dropdown-invisible)').length, 0, 'every dropdown closed');
});

test('icims: screening questions filled; login, passwords, references and essays left alone', async () => {
  const { page, summary } = await afterUpload();
  const src = page.document.getElementById('rcf3048');
  assert.strictEqual(src.options[src.selectedIndex].textContent, 'LinkedIn');
  assert.strictEqual(v(page, 'rcf2035'), '185000');
  assert.strictEqual(v(page, 'PersonProfileFields.Login'), '');
  assert.strictEqual(v(page, 'PersonProfileFields.Password'), '');
  assert.strictEqual(v(page, 'PersonProfileFields.Password_Confirm'), '');
  ['rcf3281', 'rcf3282', 'rcf3283', 'rcf3284', 'rcf3285'].forEach((r) => assert.strictEqual(v(page, '-1_PersonProfileFields.' + r), '', r));
  assert.strictEqual(v(page, 'rcf3100'), '');
  assert.strictEqual(v(page, 'rcf2049'), '');
  assert.ok(summary.attention.some((a) => /Why are you interested/.test(a.label) && a.reason === 'essay'));
  assert.strictEqual(summary.counts.failed, 0, JSON.stringify(summary.attention.filter((a) => a.status === 'failed')));
});
