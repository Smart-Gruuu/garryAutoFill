const assert = require('assert');
const { loadPage, loadFixture } = require('./harness');

const WD_URL = 'https://bonterra.wd1.myworkdayjobs.com/en-US/bonterratech/job/Remote%2C-United-States/Senior-Software-Engineer_R2026-0310/apply/applyManually';

test('workday: detects the adapter on myworkdayjobs hosts', async () => {
  const page = await loadPage({ html: loadFixture('workday-autofill-resume.html'), url: WD_URL });
  assert.strictEqual(page.GAF.engine.detectAdapter().id, 'workday');
});

test('workday: "Autofill with Resume" step (real captured markup) uploads the resume', async () => {
  const page = await loadPage({
    html: loadFixture('workday-autofill-resume.html'),
    url: WD_URL.replace('applyManually', 'autofillWithResume?jr_id=6aa42d441d92e2d05d113af3'),
  });
  const s = await page.fill();
  assert.strictEqual(page.window.__uploaded, 1, 'resume uploaded once: ' + JSON.stringify(s));
  assert.ok(/Jordan_Rivera_Resume\.pdf/.test(page.document.getElementById('uploaded').textContent));
  assert.strictEqual(s.counts.filled, 1);
  assert.strictEqual(page.window.__nextClicks, 0);
  // running again must not upload a second copy
  await page.fill();
  assert.strictEqual(page.window.__uploaded, 1);
});

test('workday: auto-fill (no click) uploads the resume on the "Autofill with Resume" step', async () => {
  const page = await loadPage({ html: loadFixture('workday-autofill-resume.html'), url: WD_URL.replace('applyManually', 'autofillWithResume') });
  page.GAF.engine.watch();
  const deadline = Date.now() + 8000;
  while (!page.window.__uploaded && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 2500)); // let follow-up mutation runs settle
  page.GAF.engine.unwatch();
  assert.strictEqual(page.window.__uploaded, 1);
});

test('workday: generic engine also recognises an unlabeled resume drop zone on non-Workday hosts', async () => {
  const page = await loadPage({ html: loadFixture('workday-autofill-resume.html'), url: 'https://careers.example.com/apply' });
  const s = await page.fill();
  assert.strictEqual(page.window.__uploaded, 1, JSON.stringify(s));
});

let wizard = null;
async function filledWizard() {
  if (!wizard) {
    wizard = (async () => {
      const page = await loadPage({ html: loadFixture('workday-wizard.html'), url: WD_URL });
      const summary = await page.fill();
      return { page, summary };
    })();
  }
  return wizard;
}

const byId = (page, id) => page.document.querySelector('[id="' + id + '"]');

test('workday: My Information — text fields, selects, radio, prompts', async () => {
  const { page, summary } = await filledWizard();
  const st = page.window.__state;
  assert.strictEqual(byId(page, 'name--legalName--firstName').value, 'Jordan', JSON.stringify(summary.counts));
  assert.strictEqual(byId(page, 'name--legalName--lastName').value, 'Rivera');
  assert.strictEqual(byId(page, 'address--addressLine1').value, '500 Market St');
  assert.strictEqual(byId(page, 'address--city').value, 'San Francisco');
  assert.strictEqual(byId(page, 'address--postalCode').value, '94105');
  assert.strictEqual(byId(page, 'emailAddress--emailAddress').value, 'jordan.rivera@example.com');
  assert.strictEqual(byId(page, 'phoneNumber--phoneNumber').value, '4155550134');
  assert.strictEqual(byId(page, 'phoneNumber--extension').value, '', 'extension untouched');
  assert.strictEqual(st['address--countryRegion'], 'California');
  assert.strictEqual(st['phoneNumber--phoneType'], 'Mobile');
  assert.strictEqual(byId(page, 'country--country').textContent, 'United States of America', 'prefilled country kept');
  const no = page.$$('input[name="candidateIsPreviousWorker"]').find((r) => r.checked);
  assert.ok(no && no.value === 'false', 'previous worker = No');
  assert.strictEqual(st['source--source'], 'LinkedIn', 'how did you hear (inside "Job Board" category)');
  assert.strictEqual(page.$('#name--preferredCheck').checked, false, 'preferred name checkbox untouched');
});

test('workday: My Experience — panels added and filled, dates, prompts, upload', async () => {
  const { page } = await filledWizard();
  const st = page.window.__state;
  const exp = page.$$('[data-fkit-id^="workExperience-"][data-fkit-id$="--null"]').map((p) => p.getAttribute('data-fkit-id').replace('--null', ''));
  assert.strictEqual(exp.length, 2, 'a second work experience panel was added');
  assert.strictEqual(byId(page, exp[0] + '--jobTitle').value, 'Senior Software Engineer');
  assert.strictEqual(byId(page, exp[0] + '--companyName').value, 'Acme Robotics');
  assert.strictEqual(byId(page, exp[0] + '--location').value, 'San Francisco, CA');
  assert.strictEqual(byId(page, exp[0] + '--currentlyWorkHere').checked, true);
  assert.strictEqual(st[exp[0] + '--startDate'], '03/2021');
  assert.strictEqual(byId(page, exp[1] + '--jobTitle').value, 'Software Engineer');
  assert.strictEqual(byId(page, exp[1] + '--companyName').value, 'Globex');
  assert.strictEqual(byId(page, exp[1] + '--currentlyWorkHere').checked, false);
  assert.strictEqual(st[exp[1] + '--startDate'], '06/2018');
  assert.strictEqual(st[exp[1] + '--endDate'], '02/2021');
  assert.strictEqual(byId(page, exp[1] + '--roleDescription').value, 'Built internal tools.');

  const edu = page.$$('[data-fkit-id^="education-"][data-fkit-id$="--null"]').map((p) => p.getAttribute('data-fkit-id').replace('--null', ''));
  assert.strictEqual(edu.length, 1, 'an education panel was added');
  assert.strictEqual(st[edu[0] + '--school'], 'University of California, Berkeley');
  assert.strictEqual(st[edu[0] + '--degree'], "Bachelor's Degree");
  assert.strictEqual(st[edu[0] + '--fieldOfStudy'], 'Computer Science');
  assert.strictEqual(byId(page, edu[0] + '--gradeAverage').value, '3.7');
  assert.strictEqual(st[edu[0] + '--firstYearAttended'], '2014');
  assert.strictEqual(st[edu[0] + '--lastYearAttended'], '2018');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(st['skills--skills'] || [])).sort(),
    ['JavaScript', 'Node.js', 'Python (Programming Language)', 'React.js', 'TypeScript']);
  assert.strictEqual(page.window.__uploads, 1, 'resume uploaded to Resume/CV');
  const web = page.$$('[data-fkit-id^="webAddress-"][data-fkit-id$="--null"]').map((p) => p.getAttribute('data-fkit-id').replace('--null', ''));
  assert.strictEqual(web.length, 2, 'website panels for portfolio + github');
  assert.strictEqual(byId(page, web[0] + '--url').value, 'https://jordanrivera.dev');
  assert.strictEqual(byId(page, web[1] + '--url').value, 'https://github.com/jrivera');
  assert.strictEqual(byId(page, 'socialNetworkAccounts--linkedInAccount').value, 'https://www.linkedin.com/in/jordan-rivera');
  assert.strictEqual(byId(page, 'socialNetworkAccounts--facebookAccount').value, '');
});

test('workday: Application Questions — screening answered, essay left for the user', async () => {
  const { page, summary } = await filledWizard();
  const st = page.window.__state;
  assert.strictEqual(st['primaryQuestionnaire--q1'], 'Yes');
  assert.strictEqual(st['primaryQuestionnaire--q2'], 'No');
  assert.strictEqual(st['primaryQuestionnaire--q4'], 'Yes, I would consider relocating for this role');
  assert.strictEqual(byId(page, 'primaryQuestionnaire--q3').value, '');
  assert.ok(summary.attention.some((a) => /Why are you interested/.test(a.label) && a.reason === 'essay'), JSON.stringify(summary.attention));
});

test('workday: Voluntary Disclosures and Self Identify — EEO filled, consent and signature left alone', async () => {
  const { page, summary } = await filledWizard();
  const st = page.window.__state;
  assert.strictEqual(st['personalInfoUS--gender'], 'I do not wish to self-identify');
  assert.strictEqual(st['personalInfoUS--hispanicOrLatino'], 'No');
  assert.strictEqual(st['personalInfoUS--veteranStatus'], 'I am not a protected veteran');
  const eth = page.$$('[data-automation-id="ethnicityMulti-CheckboxGroup"] input').filter((c) => c.checked).map((c) => c.labels[0].textContent);
  assert.deepStrictEqual(eth, ['Asian (United States of America)']);
  assert.strictEqual(byId(page, 'termsAndConditions--acceptTermsAndAgreements').checked, false);
  assert.strictEqual(byId(page, 'selfIdentifiedDisabilityData--name').value, '');
  assert.strictEqual(st['selfIdentifiedDisabilityData--dateSignedOn'], undefined);
  const dis = page.$$('[data-automation-id="disabilityStatus-CheckboxGroup"] input').filter((c) => c.checked).map((c) => c.labels[0].textContent);
  assert.deepStrictEqual(dis, ['No, I do not have a disability and have not had one in the past']);
  assert.ok(summary.attention.some((a) => /terms and conditions/i.test(a.label) && a.reason === 'consent'));
});

test('workday: never clicks Save and Continue, never touches the honeypot or header search', async () => {
  const { page, summary } = await filledWizard();
  assert.strictEqual(page.window.__nextClicks, 0);
  assert.strictEqual(page.$('[data-automation-id="beecatcher"]').value, '');
  assert.strictEqual(page.$('#jobSearch').value, '');
  assert.strictEqual(summary.counts.failed, 0, 'no failures: ' + JSON.stringify(summary.attention.filter((a) => a.status === 'failed')));
});

test('workday: dropdowns end up closed with the choice committed (no re-open during the closing animation)', async () => {
  const { page } = await filledWizard();
  await new Promise((r) => setTimeout(r, 500));
  assert.strictEqual(page.window.__cksReopens, 0, 'a menu was re-opened by clicking its button while closing');
  assert.strictEqual(page.$$('button[aria-haspopup="listbox"][aria-expanded="true"]').length, 0, 'a menu is still open');
  assert.strictEqual(page.$$('.cks-popup').length, 0);
});

test('workday: a second run keeps everything and adds nothing', async () => {
  const { page } = await filledWizard();
  const panelsBefore = page.$$('[data-fkit-id$="--null"]').length;
  const s = await page.fill();
  assert.strictEqual(s.counts.filled, 0, JSON.stringify(s.filled));
  assert.strictEqual(page.$$('[data-fkit-id$="--null"]').length, panelsBefore);
  assert.strictEqual(page.window.__uploads, 1);
});
