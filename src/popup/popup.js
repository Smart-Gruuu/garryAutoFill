/* Garry AutoFill - toolbar popup. */
(function () {
  'use strict';
  const S = globalThis.GAF_SHARED;
  const $ = (id) => document.getElementById(id);
  const REASONS = {
    essay: 'Open-ended \u2014 yours to answer',
    consent: 'Agreement / signature \u2014 review yourself',
    sensitive: 'Sensitive \u2014 left blank',
    failed: 'Could not fill \u2014 please check',
    nodata: 'Required, no answer in profile',
    unknown: 'Required, not recognised',
  };

  let tab = null;

  function send(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res)));
  }

  function openOptions() {
    chrome.runtime.openOptionsPage();
    window.close();
  }

  function chip(cls, text) {
    const s = document.createElement('span');
    s.className = 'chip ' + cls;
    s.textContent = text;
    return s;
  }

  function showResult(res) {
    const box = $('result');
    box.hidden = false;
    const chips = $('chips');
    chips.textContent = '';
    const list = $('attention');
    list.textContent = '';
    if (!res || !res.ok) {
      chips.appendChild(chip('bad', 'Could not run on this page'));
      return;
    }
    if (res.emptyProfile) {
      $('emptyProfile').hidden = false;
      return;
    }
    const c = res.counts || {};
    const forYou = (res.attention || []).filter((a) => a.status === 'skipped').length;
    chips.appendChild(chip('ok', `${c.filled || 0} filled`));
    chips.appendChild(chip('warn', `${forYou} for you`));
    if (c.failed) chips.appendChild(chip('bad', `${c.failed} failed`));
    if (c.kept) chips.appendChild(chip('', `${c.kept} already set`));
    (res.attention || []).slice(0, 40).forEach((a) => {
      const li = document.createElement('li');
      li.textContent = a.label;
      const why = document.createElement('span');
      why.textContent = a.status === 'failed' ? REASONS.failed : (REASONS[a.reason] || REASONS[a.status] || a.reason);
      li.appendChild(why);
      list.appendChild(li);
    });
    if (res.adapter) $('site').textContent = res.adapter;
  }

  async function detect() {
    if (!tab || !/^(https?|file):/.test(tab.url || '')) {
      $('site').textContent = 'Not a web page';
      $('siteSub').textContent = 'Open a job application to use autofill.';
      $('fillBtn').disabled = true;
      return;
    }
    const res = await send({ type: 'GAF_STATUS_TAB', tabId: tab.id });
    if (!res || !res.ok) {
      $('site').textContent = 'This page cannot be filled';
      $('siteSub').textContent = 'Chrome blocks extensions on some pages.';
      $('fillBtn').disabled = true;
      return;
    }
    if (res.adapterId && res.adapterId !== 'generic') {
      $('site').textContent = res.adapter;
      $('siteSub').textContent = res.fieldCount ? `${res.fieldCount} fields on this step` : 'No form fields on this step yet';
    } else {
      $('site').textContent = res.fieldCount ? 'Application form' : 'No application form detected';
      $('siteSub').textContent = res.fieldCount ? `${res.fieldCount} fields \u00b7 generic matching` : 'You can still try autofill.';
    }
    if (res.last && res.last.counts) {
      showResult({ ok: true, counts: res.last.counts, attention: res.last.attention, adapter: res.adapter });
    }
  }

  async function init() {
    $('openOptions').addEventListener('click', openOptions);
    $('setupProfile').addEventListener('click', openOptions);

    const { profile, settings } = await S.loadAll();
    if (!(profile.firstName || profile.lastName || profile.email)) $('emptyProfile').hidden = false;

    const toggle = $('autoToggle');
    toggle.checked = !!settings.autoFillOnAtsSites;
    toggle.addEventListener('change', () => S.saveSettings(Object.assign({}, settings, { autoFillOnAtsSites: toggle.checked })));

    try {
      const cmds = await chrome.commands.getAll();
      const c = cmds.find((x) => x.name === 'fill-page');
      if (c) $('shortcut').textContent = c.shortcut || 'not set';
    } catch (_) { /* ignore */ }

    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    $('fillBtn').addEventListener('click', async () => {
      const btn = $('fillBtn');
      btn.disabled = true;
      btn.textContent = 'Filling\u2026';
      const res = await send({ type: 'GAF_FILL_TAB', tabId: tab.id, trigger: 'manual' });
      btn.disabled = false;
      btn.textContent = 'Autofill this page';
      showResult(res);
    });

    detect();
  }

  init();
})();
