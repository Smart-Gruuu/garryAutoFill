/* Garry AutoFill - service worker: injects the content bundle on demand and fans "fill" out to every frame. */
/* global GAF_BUNDLE */
importScripts('../content/bundle-files.js');

async function framesOf(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames || []).filter((f) => /^(https?|file):/.test(f.url) || f.url === 'about:blank' || f.url === 'about:srcdoc');
  } catch (_) {
    return [{ frameId: 0 }];
  }
}

async function isInjected(tabId, frameId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => !!(globalThis.GAF && globalThis.GAF.__booted),
    });
    return !!(res && res.result);
  } catch (_) {
    return null; // frame is not scriptable (chrome://, web store, sandboxed...)
  }
}

async function injectFrame(tabId, frameId) {
  const already = await isInjected(tabId, frameId);
  if (already !== false) return already === true;
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: GAF_BUNDLE });
    return true;
  } catch (e) {
    console.warn('[GarryAutoFill] injection failed', tabId, frameId, e && e.message);
    return false;
  }
}

async function injectAll(tabId) {
  const frames = await framesOf(tabId);
  const ok = await Promise.all(frames.map((f) => injectFrame(tabId, f.frameId).then((r) => (r ? f.frameId : null))));
  return ok.filter((x) => x != null);
}

async function fillTab(tabId, trigger) {
  const frameIds = await injectAll(tabId);
  const results = await Promise.all(frameIds.map(async (frameId) => {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: (t) => (globalThis.GAF && globalThis.GAF.engine ? globalThis.GAF.engine.run({ trigger: t }) : null),
        args: [trigger || 'manual'],
      });
      return res && res.result ? Object.assign({ frameId }, res.result) : null;
    } catch (e) {
      return { frameId, error: String(e && e.message) };
    }
  }));
  const frames = results.filter(Boolean);
  const total = { filled: 0, skipped: 0, failed: 0, nodata: 0, kept: 0, unknown: 0 };
  frames.forEach((r) => Object.keys(total).forEach((k) => { total[k] += (r.counts && r.counts[k]) || 0; }));
  const main = frames
    .filter((r) => r.counts)
    .sort((a, b) => (b.counts.filled + b.counts.skipped + b.counts.kept) - (a.counts.filled + a.counts.skipped + a.counts.kept))[0];
  return {
    ok: true,
    adapter: main ? main.adapter : null,
    counts: total,
    attention: frames.flatMap((r) => r.attention || []),
    emptyProfile: frames.some((r) => r.error === 'empty-profile'),
    frames: frames.length,
  };
}

async function statusTab(tabId) {
  const frameIds = await injectAll(tabId);
  const out = await Promise.all(frameIds.map(async (frameId) => {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: () => (globalThis.GAF && globalThis.GAF.engine ? globalThis.GAF.engine.status() : null),
      });
      return res && res.result ? Object.assign({ frameId }, res.result) : null;
    } catch (_) {
      return null;
    }
  }));
  const frames = out.filter(Boolean);
  const specific = frames.filter((f) => f.adapterId !== 'generic').sort((a, b) => b.fieldCount - a.fieldCount);
  const best = specific[0] || frames.slice().sort((a, b) => b.fieldCount - a.fieldCount)[0];
  return {
    ok: true,
    adapter: best ? best.adapter : null,
    adapterId: best ? best.adapterId : null,
    fieldCount: frames.reduce((s, f) => s + (f.fieldCount || 0), 0),
    last: best ? best.last : null,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return undefined;
  switch (msg.type) {
    case 'GAF_ENSURE_INJECTED':
      if (!sender.tab) return undefined;
      injectFrame(sender.tab.id, sender.frameId || 0).then((ok) => sendResponse({ ok }));
      return true;
    case 'GAF_FILL_TAB': {
      const tabId = msg.tabId || (sender.tab && sender.tab.id);
      if (!tabId) { sendResponse({ ok: false, error: 'no tab' }); return undefined; }
      fillTab(tabId, msg.trigger).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message) }));
      return true;
    }
    case 'GAF_STATUS_TAB':
      statusTab(msg.tabId).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message) }));
      return true;
    case 'GAF_OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return undefined;
    default:
      return undefined;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null && /^(https?|file):/.test(tab.url || '')) fillTab(tab.id, 'manual');
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'gaf-fill', title: 'Autofill this job application', contexts: ['page', 'editable', 'frame'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'gaf-fill' && tab && tab.id != null) fillTab(tab.id, 'manual');
});
