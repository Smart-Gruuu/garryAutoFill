/*
 * Garry AutoFill - iCIMS adapter (classic career portal: careers-<company>.icims.com/jobs/<id>/<slug>/candidate).
 *
 * The form lives in iframe#icims_content_iframe (same host, ?in_iframe=1); the loader injects into that frame.
 * Candidate profile form (form#profileForm):
 *   - standard fields: PersonProfileFields.FirstName / LastName / Email, collections "-1_PersonProfileFields.Phone*",
 *     "-1_PersonProfileFields.Address*", custom questions rcf####; labels are <label id="label_<id>" for="<id>">
 *   - "Login / Password / Password (Re-enter)" for new accounts sit in the same form: left for the user
 *   - iCIMS dropdown widget for select[icimsdropdown-enabled="1"]: the native <select> is hidden; the widget renders
 *       a.dropdown-select#<id>_icimsDropdown[role=combobox] > span.dropdown-text
 *       div.dropdown-container#<id>_icimsDropdown_ctnr > input.dropdown-search + ul#<id>_dropdown-results > li.result-selectable[role=option]
 *     It opens on a document *mousedown* whose target is the fake select, filters on search-box *keyup*
 *     (AJAX lists load 25 options per page, so search), and selects on *click* of a result.
 *   - choosing a resume file runs `this.form.submit()` with &uploadResume=1: iCIMS parses the resume and reloads
 *     the page. We upload first, stop the run, and fill the rest after the reload (auto-fill or a second click).
 */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  const { sleep, waitFor, normalize, cleanLabel } = GAF.util;
  const D = GAF.dom;
  const S = GAF.set;

  const HOST_RE = /(^|\.)icims\.com$/;
  const RESUME_FLAG = 'gaf-icims-resume-uploaded';

  const ID_KEYS = [
    [/PersonProfileFields\.Login$/, { skip: 'sensitive', reason: 'account login - enter it yourself' }],
    [/PersonProfileFields\.FirstName$/, 'firstName'],
    [/PersonProfileFields\.MiddleName$/, 'middleName'],
    [/PersonProfileFields\.LastName$/, 'lastName'],
    [/PersonProfileFields\.Email$/, 'email'],
    [/PersonProfileFields\.PhoneType$/, 'phoneType'],
    [/PersonProfileFields\.PhoneNumber$/, 'phone'],
    [/PersonProfileFields\.PhoneExtension$/, { skip: 'unknown', reason: 'not part of your profile' }],
    [/PersonProfileFields\.AddressType$/, 'addressType'],
    [/PersonProfileFields\.AddressStreet1$/, 'addressLine1'],
    [/PersonProfileFields\.AddressStreet2$/, 'addressLine2'],
    [/PersonProfileFields\.AddressCity$/, 'city'],
    [/PersonProfileFields\.AddressZip$/, 'postalCode'],
    [/PersonProfileFields\.AddressCountry$/, 'country'],
    [/PersonProfileFields\.AddressState$/, 'state'],
    [/PersonProfileFields\.AddressCounty$/, 'county'],
    [/PortalProfileFields\.Resume_File$/, 'resume'],
    [/PortalProfileFields\.CoverLetter_File$/, 'coverLetterFile'],
  ];

  // ------------------------------------------------------------------------------------------ resume

  function resumeAutoSubmits(input) {
    return /\.submit\(\)|uploadResume/.test(input.getAttribute('onchange') || '');
  }

  function resumeAlreadyAttached() {
    const name = document.getElementById('PortalProfileFields.Resume_FileName');
    if (name && name.value) return true;
    const flag = document.getElementById('PortalProfileFields.Resume');
    if (flag && flag.value === 'true') return true;
    const del = document.getElementById('PortalProfileFields.Resume_Button');
    if (del && D.isVisible(del)) return true;
    if (/[?&]uploadResume=1\b/.test(location.search)) return true;
    try {
      const at = Number(sessionStorage.getItem(RESUME_FLAG + location.pathname) || 0);
      if (at && Date.now() - at < 15 * 60 * 1000) return true; // uploaded from this tab recently: never loop
    } catch (_) { /* storage blocked */ }
    return false;
  }

  function rememberUpload() {
    try { sessionStorage.setItem(RESUME_FLAG + location.pathname, String(Date.now())); } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------------------------------------ dropdown widget

  function widgetParts(select) {
    const fake = document.getElementById(select.id + '_icimsDropdown');
    if (!fake) return null;
    const container = document.getElementById(fake.id + '_ctnr') || (fake.nextElementSibling && fake.nextElementSibling.classList.contains('dropdown-container') ? fake.nextElementSibling : null);
    const results = document.getElementById(select.id + '_dropdown-results') || (container && container.querySelector('ul'));
    const search = container && container.querySelector('input.dropdown-search');
    return { fake, container, results, search };
  }

  function widgetText(parts) {
    const t = parts.fake.querySelector('.dropdown-text') || parts.fake;
    if (t.querySelector('.dropdown-placeholder')) return '';
    return cleanLabel(D.textOf(t));
  }

  function isOpen(parts) {
    return parts.fake.getAttribute('aria-expanded') === 'true' || !!(parts.container && !parts.container.classList.contains('dropdown-invisible'));
  }

  function resultItems(parts) {
    if (!parts.results) return [];
    return Array.from(parts.results.querySelectorAll('li[role="option"]'))
      .filter((li) => li.classList.contains('result-selectable') && !li.classList.contains('dropdown-invisible'));
  }

  const itemText = (li) => cleanLabel(li.getAttribute('title') || li.getAttribute('aria-label') || D.textOf(li));

  function closeWidget(parts) {
    if (!isOpen(parts)) return;
    // the widget collapses on a mousedown outside its container
    S.fire(document.body, 'mousedown');
    S.fire(document.body, 'mouseup');
  }

  async function fillWidget(field, ans, ctx) {
    const select = field.el;
    const parts = widgetParts(select);
    if (!parts) return undefined;
    const key = field.classification.key;
    const choose = (lis) => GAF.options.pick(lis.map(itemText), ans.value, key, { country: ctx.profile.country });
    const signature = (lis) => lis.map(itemText).join('|');

    D.scrollIntoViewIfNeeded(parts.fake);
    if (!isOpen(parts)) S.fire(parts.fake, 'mousedown');
    let items = (await waitFor(() => (resultItems(parts).length ? resultItems(parts) : null), { timeout: 5000 })) || [];
    let idx = items.length ? choose(items) : -1;

    const canSearch = parts.search && !parts.search.classList.contains('dropdown-invisible') && parts.search.getAttribute('aria-hidden') !== 'true';
    if (idx < 0 && canSearch) {
      const query = String(ans.query || ans.value);
      const before = signature(items);
      S.focusEl(parts.search);
      S.nativeSetValue(parts.search, query);
      S.fire(parts.search, 'input', { data: query });
      S.fire(parts.search, 'keyup', { key: query.slice(-1) });
      // AJAX lists debounce the request for >= 500ms
      items = (await waitFor(() => {
        const now = resultItems(parts);
        return now.length && signature(now) !== before ? now : null;
      }, { timeout: 6000 })) || resultItems(parts);
      idx = items.length ? choose(items) : -1;
    }

    if (idx < 0) {
      closeWidget(parts);
      return false;
    }
    const want = normalize(itemText(items[idx]));
    items[idx].click();
    const ok = await waitFor(() => normalize(widgetText(parts)) === want || (select.selectedIndex >= 0 && normalize(select.options[select.selectedIndex].textContent) === want), { timeout: 2500 });
    closeWidget(parts);
    await sleep(150); // dependent dropdowns (State after Country) reload their options
    return !!ok;
  }

  // ------------------------------------------------------------------------------------------ adapter

  GAF.registerAdapter({
    id: 'icims',
    name: 'iCIMS',
    passDelay: 700,
    stepDelay: 120,
    afterUploadDelay: 0,

    match({ host, doc }) {
      if (HOST_RE.test(host)) return true;
      try { return !!doc.querySelector('form#profileForm .iCIMS_Forms_Global, .iCIMS_MainWrapper .iCIMS_Forms_Global'); } catch (_) { return false; }
    },

    exclude(el) {
      if (el.closest('.dropdown-container')) return true; // widget search boxes
      if (el.matches('a.dropdown-select')) return true; // represented by its native <select>
      return false;
    },

    collect(fields) {
      const out = [];
      for (const f of fields) {
        const el = f.el;
        if (el.tagName === 'SELECT' && el.getAttribute('icimsdropdown-enabled') === '1' && document.getElementById(el.id + '_icimsDropdown')) {
          f.widget = 'icims';
          f.kind = 'combobox'; // AJAX lists have no <option>s until opened
          f.options = null;
          f.markEl = document.getElementById(el.id + '_icimsDropdown');
          const lbl = document.getElementById('label_' + el.id);
          if (lbl) f.label = cleanLabel(D.textOf(lbl));
          else if (el.getAttribute('data-label')) f.label = cleanLabel(el.getAttribute('data-label'));
        } else if (el.id && document.getElementById('label_' + el.id) && (f.kind === 'text' || f.kind === 'select' || f.kind === 'textarea')) {
          f.label = cleanLabel(D.textOf(document.getElementById('label_' + el.id)));
        }
        if (f.kind === 'file' && /Resume_File$/.test(el.id)) {
          f.label = 'Resume';
          f.markEl = document.getElementById('PortalProfileFields.Resume_UploadButtons') || el.parentElement;
        }
        out.push(f);
      }
      return out;
    },

    classify(field) {
      const id = field.el.id || '';
      for (const [re, key] of ID_KEYS) {
        if (re.test(id)) return typeof key === 'string' ? { key, via: 'icims' } : key;
      }
      return null; // custom questions (rcf####) go through the generic classifier
    },

    resolve(key, field, ctx) {
      if (key === 'addressType') return { value: 'Home' };
      if (key === 'country') return ctx.profile.country ? { value: ctx.profile.country, query: GAF.options.countryKey(ctx.profile.country) === 'united states' ? 'United States' : ctx.profile.country } : null;
      return undefined;
    },

    isEmpty(field) {
      if (field.widget === 'icims') {
        const sel = field.el;
        const opt = sel.options[sel.selectedIndex];
        if (opt && opt.value && opt.value !== '-999' && !GAF.options.isPlaceholder(opt.textContent)) return false;
        const parts = widgetParts(sel);
        return !(parts && widgetText(parts) && !GAF.options.isPlaceholder(widgetText(parts)));
      }
      if (field.kind === 'file' && /Resume_File$/.test(field.el.id)) return !resumeAlreadyAttached();
      return undefined;
    },

    async fill(field, ans, ctx) {
      if (field.widget === 'icims') return fillWidget(field, ans, ctx);
      if (field.kind === 'file' && /Resume_File$/.test(field.el.id)) {
        const willReload = resumeAutoSubmits(field.el);
        rememberUpload();
        const ok = await S.setFile(field.el, ans.value);
        if (ok && willReload) {
          ctx.abort = 'Resume attached. iCIMS reloads the page to read it, and the rest fills in after the reload.';
        }
        return ok;
      }
      return undefined;
    },
  });
})();
