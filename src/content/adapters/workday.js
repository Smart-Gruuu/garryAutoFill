/*
 * Garry AutoFill - Workday adapter (Candidate Experience apply flow, 2024+ "fkit" DOM, with legacy fallbacks).
 *
 * DOM conventions (see docs/research): every field sits in
 *   div[data-automation-id="formField-<metadataId>"][data-fkit-id="<origin>--<metadataId>"]
 * where origin is the section instance (name, address, workExperience-37, primaryQuestionnaire...).
 * Widgets: Canvas Kit Select (button[aria-haspopup=listbox] + body-portaled ul[role=listbox]),
 * UXI prompt (input[data-uxi-widget-type=selectinput], search on Enter keyup, popup linked by data-associated-widget),
 * DateInput (dateSectionMonth/Day/Year spinbutton inputs, commits when focus leaves the wrapper),
 * upload drop zone (input[data-automation-id=file-upload-input-ref]), repeatable panels (button[data-automation-id=add-button]).
 *
 * Never clicks pageFooterNextButton ("Save and Continue"/"Submit") or anything on the sign-in screens.
 */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  const { sleep, waitFor, normalize, cleanLabel, cssEscape } = GAF.util;
  const D = GAF.dom;
  const S = GAF.set;

  const HOST_RE = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/;
  const APPLY_SIGNALS = '[data-automation-id="applyFlowPage"], [data-mfe-id="applyFlow"], [data-automation-id^="formField-"][data-fkit-id], [data-automation-id="bottom-navigation-next-button"], input[data-automation-id="legalNameSection_firstName"]';
  const AUTH_SCOPE = '[data-automation-id="signInFormo"], [data-automation-id="signInContent"], [data-automation-id="createAccountForm"], [data-automation-id="signInForm"]';
  const POPUP_SCOPE = '[data-automation-id="responsiveMonikerPrompt"], [data-automation-widget="wd-popup"], [data-automation-id="wd-popup-frame"], [data-automation-id="datePicker"]';

  const SKIP = { skip: 'unknown', reason: 'not part of your profile' };
  const CONSENT = { skip: 'consent', reason: 'agreement / signature \u2014 complete it yourself' };

  // metadataId -> profile key (section-independent)
  const KEY_BY_MD = {
    'legalName--firstName': 'firstName',
    'legalName--middleName': 'middleName',
    'legalName--lastName': 'lastName',
    'legalName--title': SKIP,
    'legalName--social': SKIP,
    'preferredCheck': SKIP,
    'preferredName--firstName': 'preferredName',
    'preferredName--lastName': 'lastName',
    country: 'country',
    addressLine1: 'addressLine1',
    addressLine2: 'addressLine2',
    city: 'city',
    countryRegion: 'state',
    postalCode: 'postalCode',
    regionSubdivision1: 'county',
    addressLookup: SKIP,
    emailAddress: 'email',
    phoneType: 'phoneType',
    deviceType: 'phoneType',
    countryPhoneCode: 'phoneCountryCode',
    phoneNumber: 'phoneNumber',
    extension: SKIP,
    source: 'howDidYouHear',
    referredBy: 'referrerName',
    candidateIsPreviousWorker: 'previouslyEmployed',
    jobTitle: 'exp.title',
    companyName: 'exp.company',
    currentlyWorkHere: 'exp.current',
    roleDescription: 'exp.description',
    school: 'edu.school',
    schoolName: 'edu.school',
    degree: 'edu.degree',
    fieldOfStudy: 'edu.field',
    gradeAverage: 'edu.gpa',
    firstYearAttended: 'edu.startYear',
    lastYearAttended: 'edu.endYear',
    skills: 'skills',
    linkedInAccount: 'linkedin',
    twitterAccount: 'twitter',
    facebookAccount: SKIP,
    url: 'website',
    acceptTermsAndAgreements: CONSENT,
    gender: 'gender',
    ethnicity: 'race',
    ethnicityMulti: 'race',
    hispanicOrLatino: 'hispanicLatino',
    veteranStatus: 'veteran',
    disabilityStatus: 'disability',
    disabilityForm: SKIP,
    employeeId: SKIP,
    dateSignedOn: CONSENT,
  };

  // ------------------------------------------------------------------------------------------ helpers

  const qa = (root, sel) => Array.from((root || document).querySelectorAll(sel));
  const pad2 = (n) => String(n).padStart(2, '0');

  function applyRoot() {
    return document.querySelector('[data-automation-id="applyFlowPage"]') || document.querySelector('[data-mfe-id="applyFlow"]');
  }

  function formFieldOf(el) {
    return el && el.closest ? el.closest('[data-automation-id^="formField-"]') : null;
  }

  /** "<origin>--<metadataId>" from the wrapper's data-fkit-id, falling back to the control id. */
  function fkitParts(el) {
    const ff = formFieldOf(el);
    const aid = (ff && ff.getAttribute('data-automation-id')) || '';
    let md = aid.startsWith('formField-') ? aid.slice('formField-'.length) : '';
    const fk = (ff && ff.getAttribute('data-fkit-id')) || el.id || '';
    let origin = '';
    const m = /^([A-Za-z]+(?:-\d+)?)--(.+)$/.exec(fk);
    if (m) {
      origin = m[1];
      if (!md) md = m[2].replace(/-dateSection\w+-input$/, '');
    }
    return { md, origin, section: origin.replace(/-\d+$/, ''), ff };
  }

  function wrapperLabel(ff) {
    if (!ff) return '';
    const legend = ff.querySelector('legend');
    if (legend) return cleanLabel(D.textOf(legend));
    const lbl = ff.querySelector('label');
    return lbl ? cleanLabel(D.textOf(lbl)) : '';
  }

  function sectionHeading(el) {
    const grp = el.closest && el.closest('[role="group"][aria-labelledby$="-section"]');
    if (!grp) return '';
    const hd = document.getElementById(grp.getAttribute('aria-labelledby'));
    return hd ? cleanLabel(D.textOf(hd)) : '';
  }

  function isPlaceholderText(t) {
    const n = normalize(t);
    return !n || n === 'select one' || GAF.options.isPlaceholder(n);
  }

  function websites(p) {
    return [p.portfolio, p.github, p.otherUrl, p.twitter].filter((x) => x && String(x).trim());
  }

  /** Ordered panel origins ("workExperience-37") for a repeatable section. */
  function panelOrigins(sectionName) {
    return qa(document, `[data-fkit-id^="${sectionName}-"][data-fkit-id$="--null"]`)
      .map((e) => e.getAttribute('data-fkit-id').replace(/--null$/, ''))
      .filter((o) => new RegExp('^' + sectionName + '-\\d+$').test(o));
  }

  function sectionGroup(sectionName, headingRe) {
    const panel = document.querySelector(`[data-fkit-id^="${sectionName}-"][data-fkit-id$="--null"]`);
    if (panel) {
      const g = panel.closest('[role="group"][aria-labelledby$="-section"]');
      if (g) return g;
    }
    return qa(document, '[role="group"][aria-labelledby$="-section"]').find((g) => {
      const hd = document.getElementById(g.getAttribute('aria-labelledby'));
      return hd && headingRe.test(D.textOf(hd));
    }) || null;
  }

  // ------------------------------------------------------------------------------------------ widgets

  function listboxFor(btn) {
    const id = btn.getAttribute('aria-controls');
    const lb = id && document.getElementById(id);
    if (lb && D.isVisible(lb) && lb.querySelector('[role="option"]')) return lb;
    return null;
  }

  const isExpanded = (btn) => btn.getAttribute('aria-expanded') === 'true' || !!listboxFor(btn);

  /**
   * Canvas Kit keeps the listbox mounted (aria-expanded="true") during a 200ms closing animation, and a click on
   * the button while "closing" RE-OPENS the menu. So: wait for the animation, then Escape / outside mousedown.
   * Never click the button to close it.
   */
  async function closeSelect(btn) {
    if (await waitFor(() => !isExpanded(btn), { timeout: 700 })) return;
    const lb = listboxFor(btn);
    if (lb) S.pressKey(lb, 'Escape');
    if (await waitFor(() => !isExpanded(btn), { timeout: 700 })) return;
    S.fire(document.body, 'mousedown');
    S.fire(document.body, 'mouseup');
    await waitFor(() => !isExpanded(btn), { timeout: 700 });
  }

  function selectedMatches(btn, want) {
    return normalize(D.textOf(btn)) === want || (btn.getAttribute('aria-label') || '').toLowerCase().includes(want);
  }

  /** Canvas Kit Select: click button -> choose li[role=option] in the portaled listbox. */
  async function fillSelect(field, ans, ctx) {
    const btn = field.el;
    const key = field.classification.key;
    D.scrollIntoViewIfNeeded(btn);
    if (!isExpanded(btn)) btn.click();
    let lb = await waitFor(() => listboxFor(btn), { timeout: 2500 });
    if (!lb) return false;
    await sleep(260); // menu is "opening" for 200ms; act once it is "opened"
    lb = listboxFor(btn) || lb;
    const opts = qa(lb, '[role="option"]').filter((o) => o.getAttribute('aria-disabled') !== 'true');
    const texts = opts.map((o) => cleanLabel(D.textOf(o)));
    const idx = GAF.options.pick(texts, ans.value, key, { country: ctx.profile.country });
    if (idx < 0) {
      await closeSelect(btn);
      return false;
    }
    const want = normalize(texts[idx]);
    try { opts[idx].scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ }
    opts[idx].click();
    let ok = await waitFor(() => selectedMatches(btn, want), { timeout: 1500 });

    if (!ok && listboxFor(btn)) {
      // keyboard fallback: move the active option to the target and press Enter (handled by the menu's onKeyDown)
      const menu = listboxFor(btn);
      const all = qa(menu, '[role="option"]');
      const target = all.findIndex((o) => normalize(cleanLabel(D.textOf(o))) === want);
      let cur = all.findIndex((o) => o.id && o.id === menu.getAttribute('aria-activedescendant'));
      if (target >= 0) {
        if (cur < 0) cur = 0;
        const keyName = target > cur ? 'ArrowDown' : 'ArrowUp';
        for (let n = 0; n < Math.abs(target - cur) && n < 400; n++) S.pressKey(menu, keyName);
        S.pressKey(menu, 'Enter');
        ok = await waitFor(() => selectedMatches(btn, want), { timeout: 1500 });
      }
    }
    await closeSelect(btn);
    return !!ok;
  }

  function promptContainer(field) {
    const id = field.el.getAttribute('data-uxi-multiselect-id');
    return (id && document.getElementById(id)) || field.el.closest('[data-automation-id="multiSelectContainer"]') || formFieldOf(field.el);
  }

  function promptPopup(container) {
    let cands = [];
    if (container && container.id) {
      cands = qa(document, `[data-automation-id="responsiveMonikerPrompt"][data-associated-widget="${cssEscape(container.id)}"]`);
    }
    if (!cands.length) cands = qa(document, '[data-automation-id="responsiveMonikerPrompt"], [data-automation-id="activeListContainer"]');
    const vis = cands.filter(D.isVisible);
    return vis[vis.length - 1] || null;
  }

  const optionLabel = (o) => cleanLabel(o.getAttribute('data-automation-label') || D.textOf(o));

  function popupOptions(popup) {
    if (!popup) return [];
    return qa(popup, '[data-automation-id="promptOption"]').filter((o) => D.isVisible(o) && !o.closest('[data-automation-id="selectedItemList"]'));
  }

  function isCategory(opt) {
    const leaf = opt.closest('[data-automation-id="promptLeafNode"]') || opt.parentElement;
    if (!leaf) return false;
    if (leaf.querySelector('[data-automation-id="radioBtn"], [data-automation-id="checkbox"], input[type="radio"], input[type="checkbox"]')) return false;
    return !!(leaf.querySelector('[data-automation-id*="chevron" i], [data-automation-id="promptIcon"], svg') || leaf.getAttribute('data-automation-checked') == null);
  }

  function selectedPills(container) {
    const ff = formFieldOf(container) || container;
    return qa(ff, '[data-automation-id="selectedItemList"] [data-automation-id="promptOption"], [data-automation-id="selectedItemList"] [data-automation-id="selectedItem"]')
      .map((p) => optionLabel(p))
      .filter(Boolean);
  }

  function signature(opts) {
    return opts.map(optionLabel).join('|');
  }

  async function clickLeaf(opt) {
    const leaf = opt.closest('[data-automation-id="promptLeafNode"]') || opt.closest('[data-automation-id="menuItem"]') || opt;
    try { leaf.scrollIntoView({ block: 'nearest' }); } catch (_) { /* jsdom */ }
    leaf.click();
  }

  /** UXI prompt: search (Enter), pick a leaf, drill into categories when needed. */
  async function promptSelectOne(field, value, query, key, ctx) {
    const inp = field.el;
    const container = promptContainer(field);
    const strict = (texts) => GAF.options.pick(texts, value, key === 'howDidYouHear' ? 'howDidYouHear:strict' : key, { country: ctx.profile.country });
    const loose = (texts) => GAF.options.pick(texts, value, key, { country: ctx.profile.country });
    const before = selectedPills(container).join('|');
    const done = () => {
      const now = selectedPills(container).join('|');
      return now !== before && now.length > 0;
    };

    /** Waits for the popup to show a list different from prevSig (or for the value to be selected). */
    const settle = (prevSig, timeout) => waitFor(() => {
      if (done()) return { done: true };
      const p = promptPopup(container);
      if (!p || p.getAttribute('aria-busy') === 'true') return null;
      const opts = popupOptions(p);
      const empty = /no matches|no items/i.test(D.textOf(p));
      if (!opts.length && !empty) return null;
      if (prevSig != null && !empty && signature(opts) === prevSig) return null;
      return { popup: p, opts };
    }, { timeout });

    const tryPick = async (opts, chooser) => {
      const idx = chooser(opts.map(optionLabel));
      if (idx < 0) return 'nomatch';
      if (isCategory(opts[idx])) return { category: opts[idx] };
      await clickLeaf(opts[idx]);
      return (await waitFor(done, { timeout: 2000 })) ? 'ok' : 'nomatch';
    };

    const drill = async (cat, chooser) => {
      const cur = promptPopup(container);
      const sig = signature(popupOptions(cur));
      await clickLeaf(cat);
      const sub = await settle(sig, 2500);
      if (!sub) return false;
      if (sub.done) return true;
      const r = await tryPick(sub.opts, chooser);
      if (r === 'ok') return true;
      const back = sub.popup.querySelector('[data-automation-id="backButton"]');
      if (back) {
        back.click();
        await settle(signature(sub.opts), 2000);
      }
      return false;
    };

    // 1) open, then search
    D.scrollIntoViewIfNeeded(inp);
    inp.focus();
    inp.click();
    const opened = await settle(null, 1200);
    if (opened && opened.done) return true;
    const openedSig = opened ? signature(opened.opts) : null;
    S.nativeSetValue(inp, String(query || value));
    S.fire(inp, 'input');
    S.pressKey(inp, 'Enter');
    let res = await settle(openedSig, 4000);
    if (res && res.done) return true;
    if (!res && opened) res = await settle(null, 300); // the search produced the same list
    if (res && res.opts.length) {
      const r = await tryPick(res.opts, strict);
      if (r === 'ok' || done()) return true;
      if (r && r.category && (await drill(r.category, strict))) return true;
    }
    if (done()) return true;

    // 2) browse the full list and its categories
    const lastSig = res && res.opts.length ? signature(res.opts) : null;
    S.nativeSetValue(inp, '');
    S.fire(inp, 'input');
    S.pressKey(inp, 'Enter');
    res = (await settle(lastSig, 2000)) || (await settle(null, 500));
    if (!res) {
      inp.click();
      res = await settle(null, 2500);
    }
    if (!res) return done();
    if (res.done) return true;
    const top = await tryPick(res.opts, strict);
    if (top === 'ok' || done()) return true;
    const labels = res.opts.filter(isCategory).map(optionLabel);
    if (top && top.category) labels.unshift(optionLabel(top.category));
    for (const label of Array.from(new Set(labels)).slice(0, 12)) {
      const cur = await settle(null, 1500);
      if (!cur || cur.done) return done();
      const cat = cur.opts.find((o) => optionLabel(o) === label);
      if (cat && (await drill(cat, strict))) return true;
    }
    // 3) last resort for "how did you hear": an "Other" style option at the top level
    if (key === 'howDidYouHear') {
      const cur = await settle(null, 1500);
      if (cur && !cur.done && (await tryPick(cur.opts, loose)) === 'ok') return true;
    }
    return done();
  }

  function closePrompt(field) {
    S.pressKey(field.el, 'Escape');
    const p = promptPopup(promptContainer(field));
    if (p) S.fire(document.body, 'mousedown');
  }

  async function fillPrompt(field, ans, ctx) {
    const key = field.classification.key;
    try {
      if (key === 'skills') {
        const wanted = String(ans.value).split(/\s*[,;\n]\s*/).filter(Boolean).slice(0, 20);
        const have = selectedPills(promptContainer(field)).map(normalize);
        let any = false;
        for (const skill of wanted) {
          if (have.includes(normalize(skill))) continue;
          if (await promptSelectOne(field, skill, skill, 'skills', ctx)) any = true;
          closePrompt(field);
          await sleep(120);
        }
        return any;
      }
      return await promptSelectOne(field, ans.value, ans.query || ans.value, key, ctx);
    } finally {
      closePrompt(field);
      await sleep(100);
    }
  }

  /** DateInput: type each section, then move focus out of the wrapper so Workday commits the date. */
  async function fillDate(field, parts) {
    const inputs = field.members.filter((i) => i.isConnected);
    if (!inputs.length) return false;
    for (const inp of inputs) {
      const aid = inp.getAttribute('data-automation-id') || inp.id;
      const v = /Month/.test(aid) ? pad2(parts.m || 1) : /Day/.test(aid) ? pad2(parts.d || 1) : /Year/.test(aid) ? String(parts.y) : '';
      if (!v || v === 'undefined') return false;
      const sec = inp.parentElement;
      try { if (sec && sec !== field.wrapper) sec.click(); } catch (_) { /* ignore */ }
      S.focusEl(inp);
      S.nativeSetValue(inp, v);
      S.fire(inp, 'input', { data: v });
      await sleep(40);
      if (!displayHasDigits(inp)) {
        // fallback used by other Workday fillers: value n-1 then ArrowUp
        const n = parseInt(v, 10);
        S.nativeSetValue(inp, String(n - 1));
        S.pressKey(inp, 'ArrowUp');
        await sleep(40);
      }
    }
    const active = document.activeElement;
    if (active && field.wrapper.contains(active)) {
      try { active.blur(); } catch (_) { /* ignore */ }
    }
    S.fire(inputs[inputs.length - 1], 'blur');
    S.fire(inputs[inputs.length - 1], 'focusout', { relatedTarget: null });
    await sleep(120);
    return inputs.every(displayHasDigits);
  }

  function displayHasDigits(inp) {
    const disp = document.getElementById(inp.id.replace(/-input$/, '-display'));
    if (disp && /\d/.test(D.textOf(disp))) return true;
    return /\d/.test(inp.value || '') || !!inp.getAttribute('aria-valuenow');
  }

  function uploadScope(input) {
    return formFieldOf(input) || input.closest('[data-automation-id="resumeUpload"]') || input.parentElement;
  }

  function uploadedIn(scope) {
    return !!(scope && scope.querySelector('[data-automation-id="file-upload-item"], [data-automation-id="file-upload-successful"], [data-automation-id="file-upload-item-name"]'));
  }

  async function fillUpload(field, ans) {
    const input = field.el;
    const scope = uploadScope(input);
    const outer = scope && scope.parentElement;
    await S.setFile(input, ans.value);
    let seen = await waitFor(() => uploadedIn(scope) || uploadedIn(outer), { timeout: 2000 });
    if (!seen) {
      const zone = (scope && scope.querySelector('[data-automation-id="file-upload-drop-zone"]')) || (outer && outer.querySelector('[data-automation-id="file-upload-drop-zone"]'));
      if (zone) {
        await S.dropFile(zone, ans.value);
        seen = await waitFor(() => uploadedIn(scope) || uploadedIn(outer), { timeout: 2000 });
      }
    }
    if (!seen) return false;
    // wait for Workday's virus scan / resume parse to settle (bounded)
    await waitFor(() => (scope.querySelector('[data-automation-id="file-upload-successful"], [data-automation-id="file-upload-failed"]') ? true : null), { timeout: 15000 });
    return !scope.querySelector('[data-automation-id="file-upload-failed"]');
  }

  // ------------------------------------------------------------------------------------------ panels

  const preparedPages = new WeakSet();

  async function addPanels(sectionName, headingRe, want) {
    const target = Math.min(want, 6);
    for (let guard = 0; guard < 6; guard++) {
      const have = panelOrigins(sectionName).length;
      if (have >= target) return;
      const group = sectionGroup(sectionName, headingRe);
      if (!group) return;
      const btn = group.querySelector(':scope > div > button[data-automation-id="add-button"], button[data-automation-id="add-button"]');
      if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
      if (!S.safeClick(btn, { allowText: /^add( another)?$/i })) return;
      const grew = await waitFor(() => panelOrigins(sectionName).length > have, { timeout: 3000 });
      if (!grew) return;
      await sleep(250);
    }
  }

  // ------------------------------------------------------------------------------------------ adapter

  GAF.registerAdapter({
    id: 'workday',
    name: 'Workday',
    passDelay: 700,
    stepDelay: 150,
    afterUploadDelay: 300,

    match({ host, doc }) {
      if (HOST_RE.test(host)) return true;
      try { return !!doc.querySelector('[data-automation-id="applyFlowPage"], [data-mfe-id="applyFlow"]'); } catch (_) { return false; }
    },

    exclude(el) {
      if (el.matches('[data-automation-id="beecatcher"]')) return true;
      if (el.closest(AUTH_SCOPE) || el.closest(POPUP_SCOPE)) return true;
      if (el.matches('input[data-automation-id="searchBox"]')) return true;
      const root = applyRoot();
      if (root && !root.contains(el)) return true; // header job search, cookie banner, etc.
      if (!root && !document.querySelector(APPLY_SIGNALS)) return true; // job posting / search pages
      return false;
    },

    async prepare(ctx) {
      if (!ctx.settings.addMissingEntries) return;
      const expPage = document.querySelector('[data-automation-id="applyFlowMyExpPage"], [data-automation-id="myExperiencePage"]');
      if (!expPage || preparedPages.has(expPage)) return;
      preparedPages.add(expPage);
      const p = ctx.profile;
      await addPanels('workExperience', /work experience/i, (p.experience || []).filter((e) => e && (e.title || e.company)).length);
      await addPanels('education', /education/i, (p.education || []).filter((e) => e && e.school).length);
      await addPanels('webAddress', /websites?/i, websites(p).length);
    },

    collect(rawFields) {
      // The generic collector groups radios/checkboxes by name; repeated panels reuse names
      // (every "I currently work here" is name=currentlyWorkHere), so split groups per form field.
      const fields = [];
      for (const f of rawFields) {
        if ((f.kind === 'checkboxGroup' || f.kind === 'radio') && f.members.length > 1) {
          const byField = new Map();
          f.members.forEach((m) => {
            const k = m.closest('[data-automation-id$="-CheckboxGroup"]') || formFieldOf(m) || m;
            if (!byField.has(k)) byField.set(k, []);
            byField.get(k).push(m);
          });
          if (byField.size > 1) {
            byField.forEach((members) => {
              const single = f.kind === 'checkboxGroup' && members.length === 1;
              fields.push(Object.assign({}, f, {
                el: members[0],
                members,
                kind: single ? 'checkbox' : f.kind,
                label: single ? cleanLabel(D.ownLabel(members[0])) : f.label,
                question: single ? '' : f.question,
                options: single ? null : members.map((m) => cleanLabel(D.ownLabel(m))),
              }));
            });
            continue;
          }
        }
        fields.push(f);
      }

      const out = [];
      const dates = new Map();
      const groups = new Map();
      const originIndex = {};
      const indexOf = (origin) => {
        const m = /^([A-Za-z]+)-\d+$/.exec(origin || '');
        if (!m) return undefined;
        if (!originIndex[m[1]]) originIndex[m[1]] = panelOrigins(m[1]);
        const i = originIndex[m[1]].indexOf(origin);
        return i >= 0 ? i : undefined;
      };

      for (const f of fields) {
        const el = f.el;
        const parts = fkitParts(el);
        f.metadataId = parts.md;
        f.origin = parts.origin;
        f.wdSection = parts.section;
        const idx = indexOf(parts.origin);
        if (idx != null) f.index = idx;

        // DateInput sections -> one field per wrapper
        if (el.matches('input[data-automation-id^="dateSection"]')) {
          const wrapper = el.closest('[data-automation-id="dateInputWrapper"]') || parts.ff || el.parentElement.parentElement;
          let df = dates.get(wrapper);
          if (!df) {
            df = Object.assign({}, f, {
              kind: 'workdayDate', el, members: [], wrapper, markEl: wrapper,
              label: wrapperLabel(parts.ff) || f.label, question: '', options: null,
            });
            dates.set(wrapper, df);
            out.push(df);
          }
          df.members.push(el);
          continue;
        }

        if (el.matches('input[data-uxi-widget-type="selectinput"]')) {
          f.kind = 'combobox';
          f.widget = 'prompt';
          f.markEl = el.closest('[data-automation-id="multiSelectContainer"]') || parts.ff;
        } else if (el.matches('button[aria-haspopup="listbox"]')) {
          f.widget = 'select';
        } else if (f.kind === 'file') {
          f.widget = 'upload';
          f.markEl = (parts.ff || el.parentElement).querySelector('[data-automation-id="file-upload-drop-zone"]') || parts.ff;
        }

        // Checkboxes inside a CheckboxGroup become one group field
        const grp = el.closest('[data-automation-id$="-CheckboxGroup"]');
        if (grp && (f.kind === 'checkbox' || f.kind === 'checkboxGroup')) {
          let g = groups.get(grp);
          if (!g) {
            g = Object.assign({}, f, { kind: 'checkboxGroup', members: [], options: [], question: wrapperLabel(parts.ff), markEl: grp });
            g.label = g.question;
            groups.set(grp, g);
            out.push(g);
          }
          f.members.forEach((m) => {
            g.members.push(m);
            g.options.push(GAF.util.cleanLabel(D.ownLabel(m)));
          });
          continue;
        }

        const wl = wrapperLabel(parts.ff);
        if (wl) {
          if (f.kind === 'radio' || f.kind === 'checkboxGroup' || f.kind === 'ariaRadio') { f.question = wl; f.label = wl; } else if (f.kind !== 'checkbox') f.label = wl;
        }
        if (f.kind === 'file' && !f.label) f.label = sectionHeading(el) || 'Resume';
        out.push(f);
      }
      return out;
    },

    classify(field, ctx) {
      const md = field.metadataId || '';
      const section = field.wdSection || '';

      if (field.kind === 'file') {
        if (section === 'additionalAttachments') return { skip: 'unknown', reason: 'additional attachments need a category \u2014 add them yourself' };
        if (section === 'resumeAttachments' || field.el.closest('[data-automation-id="applyFlowAutoFillPage"], [data-automation-id="resumeUpload"]') || /resume|\bcv\b/i.test(sectionHeading(field.el))) {
          return { key: 'resume', via: 'workday' };
        }
        return null;
      }

      if (/Questionnaire$/.test(section)) {
        // employer questions: classify by the question text (essays stay empty)
        if (field.kind === 'workdayDate') return GAF.classifier.classify(Object.assign({}, field, { kind: 'date' }), ctx);
        return null;
      }
      if (section === 'termsAndConditions') return CONSENT;
      if (section === 'selfIdentifiedDisabilityData') {
        if (md === 'disabilityStatus') return { key: 'disability', via: 'workday' };
        if (md === 'name' || md === 'dateSignedOn') return CONSENT;
        return SKIP;
      }
      if (section === 'language' || section === 'certification') return SKIP;

      if (section === 'workExperience') {
        if (md === 'location') return { key: 'exp.location', via: 'workday' };
        if (md === 'startDate') return { key: 'exp.startDate', via: 'workday' };
        if (md === 'endDate') return { key: 'exp.endDate', via: 'workday' };
      }
      if (section === 'education') {
        if (md === 'startDate') return { key: 'edu.startYear', via: 'workday' };
        if (md === 'endDate') return { key: 'edu.endYear', via: 'workday' };
      }

      const mapped = KEY_BY_MD[md];
      if (mapped && typeof mapped === 'object') return mapped;
      if (mapped === 'phoneNumber') return { key: 'phone', via: 'workday' };
      if (mapped) return { key: mapped, via: 'workday' };
      return null;
    },

    resolve(key, field, ctx) {
      const p = ctx.profile;
      const idx = field.index || 0;
      if (field.kind === 'workdayDate') {
        const exp = (p.experience || [])[idx];
        const edu = (p.education || [])[idx];
        switch (key) {
          case 'exp.startDate': return exp && exp.startYear ? { value: { y: +exp.startYear, m: +exp.startMonth || 1 } } : null;
          case 'exp.endDate': return exp && !exp.current && exp.endYear ? { value: { y: +exp.endYear, m: +exp.endMonth || 12 } } : null;
          case 'edu.startYear':
          case 'edu.startDate': return edu && edu.startYear ? { value: { y: +edu.startYear, m: +edu.startMonth || 9 } } : null;
          case 'edu.endYear':
          case 'edu.endDate':
          case 'edu.graduationYear': return edu && edu.endYear ? { value: { y: +edu.endYear, m: +edu.endMonth || 5 } } : null;
          case 'availableStartDate': {
            const d = GAF.answers.parseIsoDate(p.availableStartDate);
            return d ? { value: d } : null;
          }
          default: return null;
        }
      }
      if (key === 'website') {
        const url = websites(p)[idx];
        return url ? { value: url } : null;
      }
      if (key === 'phoneCountryCode') {
        return p.phoneCountryCode ? { value: p.phoneCountryCode, query: GAF.options.countryKey(p.country || 'United States') === 'united states' ? 'United States of America' : p.country } : null;
      }
      if (key === 'phone' && field.kind === 'text') {
        // Workday has a separate country-code prompt; the number field wants the national number
        return p.phone ? { value: String(p.phone).replace(/^\+\d+\s*/, '') } : null;
      }
      return undefined;
    },

    isEmpty(field) {
      if (field.kind === 'workdayDate') return !field.members.some(displayHasDigits);
      if (field.widget === 'prompt') return selectedPills(promptContainer(field)).length === 0;
      if (field.widget === 'select') return isPlaceholderText(D.textOf(field.el));
      if (field.kind === 'file') {
        const scope = uploadScope(field.el);
        return !(uploadedIn(scope) || uploadedIn(scope && scope.parentElement));
      }
      return undefined;
    },

    async fill(field, ans, ctx) {
      if (field.kind === 'workdayDate') return fillDate(field, ans.value);
      if (field.widget === 'select') return fillSelect(field, ans, ctx);
      if (field.widget === 'prompt') return fillPrompt(field, ans, ctx);
      if (field.kind === 'file') return fillUpload(field, ans);
      if (field.kind === 'checkboxGroup' && field.el.closest('[data-single="1"], [data-automation-id="disabilityStatus-CheckboxGroup"]')) {
        const i = GAF.options.pick(field.options, ans.value, field.classification.key);
        if (i < 0) return false;
        return S.setChecked(field.members[i], true);
      }
      return undefined;
    },
  });
})();
