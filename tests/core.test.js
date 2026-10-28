const assert = require('assert');
const { loadPage, loadFixture } = require('./harness');

test('generic form: fills identity, contact, address, links, resume', async () => {
  const page = await loadPage({ html: loadFixture('generic-form.html') });
  const s = await page.fill();
  const v = (sel) => page.$(sel).value;
  assert.strictEqual(v('#fn'), 'Jordan');
  assert.strictEqual(v('#ln'), 'Rivera');
  assert.strictEqual(v('#pn'), 'Jo');
  assert.strictEqual(v('#em'), 'jordan.rivera@example.com');
  assert.strictEqual(v('#ph'), '4155550134');
  assert.strictEqual(v('#addr'), '500 Market St');
  assert.strictEqual(v('#city'), 'San Francisco');
  assert.strictEqual(v('#st'), 'CA');
  assert.strictEqual(v('#zip'), '94105');
  assert.strictEqual(page.$('#country').selectedOptions[0].textContent, 'United States of America');
  assert.strictEqual(v('#li'), 'https://www.linkedin.com/in/jordan-rivera');
  assert.strictEqual(v('#web'), 'https://jordanrivera.dev');
  assert.strictEqual(page.$('#resume').files.length, 1);
  assert.strictEqual(page.$('#resume').files[0].name, 'Jordan_Rivera_Resume.pdf');
  assert.strictEqual(page.$('input[name=q]').value, '', 'search box must not be filled');
  assert.ok(s.counts.filled >= 20, 'filled count ' + JSON.stringify(s.counts));
});

test('generic form: screening questions, EEO, and custom rule', async () => {
  const page = await loadPage({ html: loadFixture('generic-form.html') });
  await page.fill();
  const checked = (name) => { const r = page.$$(`input[name="${name}"]`).find((x) => x.checked); return r && r.parentElement.textContent.trim(); };
  assert.strictEqual(checked('auth'), 'Yes');
  assert.strictEqual(checked('spons'), 'No');
  assert.strictEqual(page.$('#hear').value, 'LinkedIn');
  assert.strictEqual(page.$('#sal').value, '185000');
  assert.strictEqual(page.$('#notice').value, '2 weeks');
  assert.strictEqual(page.$('#relocate').checked, true);
  assert.strictEqual(page.$('#gender').value, 'Decline To Self Identify');
  assert.strictEqual(page.$('#hisp').value, 'No');
  assert.strictEqual(page.$('#race').value, 'Asian');
  assert.strictEqual(page.$('#vet').value, 'I am not a veteran');
  assert.ok(/^No, I do not have/.test(page.$('#dis').value));
});

test('generic form: leaves essays, consent, signatures and sensitive fields alone', async () => {
  const page = await loadPage({ html: loadFixture('generic-form.html') });
  const s = await page.fill();
  assert.strictEqual(page.$('#why').value, '');
  assert.strictEqual(page.$('#extra').value, '');
  assert.strictEqual(page.$('#ssn').value, '');
  assert.strictEqual(page.$('#privacy').checked, false);
  assert.strictEqual(page.$('#sig').value, '');
  const reasons = Object.fromEntries(s.attention.map((a) => [a.label, a.reason]));
  assert.strictEqual(reasons['Why do you want to work at Acme?'], 'essay');
  assert.strictEqual(reasons['Additional information'], 'essay');
  assert.ok(Object.entries(reasons).some(([l, r]) => /privacy policy/.test(l) && r === 'consent'), JSON.stringify(reasons));
  assert.strictEqual(page.window.__submitted, 0, 'form must never be submitted');
  assert.ok(!page.window.__submitClicked, 'submit button must never be clicked');
});

test('generic form: repeated work experience and education', async () => {
  const page = await loadPage({ html: loadFixture('generic-form.html') });
  await page.fill();
  assert.strictEqual(page.$('#t0').value, 'Senior Software Engineer');
  assert.strictEqual(page.$('#c0').value, 'Acme Robotics');
  assert.strictEqual(page.$('#cur0').checked, true);
  assert.strictEqual(page.$('#t1').value, 'Software Engineer');
  assert.strictEqual(page.$('#c1').value, 'Globex');
  assert.strictEqual(page.$('#school').value, 'University of California, Berkeley');
  assert.strictEqual(page.$('#degree').value, 'Bachelor of Science');
  assert.strictEqual(page.$('#major').value, 'Computer Science');
});

test('does not overwrite existing values unless asked', async () => {
  const html = loadFixture('generic-form.html').replace('id="fn" name="first_name" required', 'id="fn" name="first_name" required value="Existing"');
  let page = await loadPage({ html });
  await page.fill();
  assert.strictEqual(page.$('#fn').value, 'Existing');
  page = await loadPage({ html, settings: { overwriteExisting: true } });
  await page.fill();
  assert.strictEqual(page.$('#fn').value, 'Jordan');
});

test('React-style controlled input receives onChange via native setter + input event', async () => {
  const html = `<!doctype html><body><form>
    <label for="a">First name</label><input id="a">
    <script>
      // emulate React's value tracker: remembers last value set through the element's own property
      const el = document.getElementById('a');
      let tracked = '';
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      Object.defineProperty(el, 'value', { configurable: true, get() { return proto.get.call(this); }, set(v) { tracked = v; proto.set.call(this, v); } });
      window.__changes = [];
      el.addEventListener('input', () => { const cur = proto.get.call(el); if (cur !== tracked) { tracked = cur; window.__changes.push(cur); } });
    </script></form></body>`;
  const page = await loadPage({ html });
  await page.fill();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(page.window.__changes)), ['Jordan']);
});

test('empty profile yields a friendly error and fills nothing', async () => {
  const page = await loadPage({ html: loadFixture('generic-form.html'), profile: {} });
  const s = await page.fill();
  assert.strictEqual(s.error, 'empty-profile');
  assert.strictEqual(page.$('#fn').value, '');
});

test('password/sign-in forms are ignored', async () => {
  const html = `<!doctype html><body><form><label for="e">Email Address</label><input id="e" type="email">
    <label for="p">Password</label><input id="p" type="password"><button type="submit">Sign In</button></form></body>`;
  const page = await loadPage({ html });
  await page.fill();
  assert.strictEqual(page.$('#e').value, '');
  assert.strictEqual(page.$('#p').value, '');
});
