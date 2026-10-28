/*
 * Garry AutoFill - tiny loader that runs in every frame. It only decides whether this frame looks like a job
 * application; if so it asks the service worker to inject the full bundle into this frame.
 */
(function () {
  'use strict';
  if (globalThis.__GAF_LOADER__) return;
  globalThis.__GAF_LOADER__ = true;

  const ATS_HOSTS = [
    /(^|\.)myworkdayjobs\.com$/, /(^|\.)myworkdaysite\.com$/, /(^|\.)myworkday\.com$/, /(^|\.)workday\.com$/,
    /(^|\.)greenhouse\.io$/, /(^|\.)lever\.co$/, /(^|\.)ashbyhq\.com$/, /(^|\.)icims\.com$/, /(^|\.)jobvite\.com$/,
    /(^|\.)adp\.com$/, /(^|\.)ultipro\.com$/, /(^|\.)ukg\.net$/, /(^|\.)paylocity\.com$/, /(^|\.)dayforcehcm\.com$/,
    /(^|\.)bamboohr\.com$/, /(^|\.)smartrecruiters\.com$/, /(^|\.)workable\.com$/, /(^|\.)applytojob\.com$/, /(^|\.)breezy\.hr$/,
    /(^|\.)oraclecloud\.com$/, /(^|\.)taleo\.net$/, /(^|\.)successfactors\.(com|eu)$/, /(^|\.)sapsf\.(com|eu)$/,
    /(^|\.)jobs\.sap\.com$/, /(^|\.)recruitee\.com$/, /(^|\.)teamtailor\.com$/, /(^|\.)rippling\.com$/, /(^|\.)rippling-ats\.com$/,
    /(^|\.)eightfold\.ai$/, /(^|\.)phenompeople\.com$/, /(^|\.)avature\.net$/, /(^|\.)jazzhr\.com$/, /(^|\.)pinpointhq\.com$/,
    /(^|\.)csod\.com$/, /(^|\.)paycomonline\.net$/, /(^|\.)paycor\.com$/, /(^|\.)brassring\.com$/,
  ];

  let requested = false;
  function request(reason) {
    if (requested) return;
    requested = true;
    try {
      chrome.runtime.sendMessage({ type: 'GAF_ENSURE_INJECTED', reason }, () => void chrome.runtime.lastError);
    } catch (_) { /* extension was reloaded - ignore */ }
  }

  if (ATS_HOSTS.some((re) => re.test(location.hostname))) {
    request('ats-host');
    return;
  }

  const EMBED_SIGNALS = '#grnhse_app, #grnhse_iframe, iframe[src*="greenhouse.io"], iframe[src*="icims.com"], iframe[src*="lever.co"], ' +
    'iframe[src*="myworkdayjobs"], iframe[src*="smartrecruiters"], iframe[src*="workable.com"], iframe[src*="ashbyhq"]';

  function looksLikeApplication() {
    const doc = document;
    if (!doc.body) return false;
    if (doc.querySelector(EMBED_SIGNALS)) return true;
    const email = doc.querySelector('input[type="email"], input[autocomplete="email"], input[name*="email" i], input[id*="email" i]');
    if (!email) return false;
    const name = doc.querySelector('input[autocomplete="given-name"], input[name*="first" i], input[id*="first" i], input[name*="name" i], input[id*="name" i]');
    const file = doc.querySelector('input[type="file"]');
    const h1 = doc.querySelector('h1');
    const hint = (doc.title + ' ' + location.pathname + ' ' + (h1 ? h1.textContent : '')).toLowerCase();
    const applyish = /apply|application|career|job|candidate|recruit|position|opening|vacanc|hiring/.test(hint);
    return !!(name && (file || applyish || doc.querySelector('textarea')));
  }

  if (looksLikeApplication()) {
    request('form-heuristic');
    return;
  }

  // SPA pages render forms later; watch DOM activity for a while.
  let timer = null;
  const obs = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (looksLikeApplication()) { obs.disconnect(); request('form-heuristic'); }
    }, 700);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => obs.disconnect(), 5 * 60 * 1000);
})();
