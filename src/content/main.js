/* Garry AutoFill - boot: message handling, floating button, auto-fill watcher. Last file of the content bundle. */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || GAF.__booted) return;
  GAF.__booted = true;

  const isTop = (() => { try { return window.top === window; } catch (_) { return false; } })();

  if (globalThis.chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return undefined;
      if (msg.type === 'GAF_FILL_FRAME') {
        GAF.engine.run({ trigger: msg.trigger || 'manual' }).then(sendResponse, (e) => sendResponse({ error: String(e) }));
        return true;
      }
      if (msg.type === 'GAF_STATUS_FRAME') {
        sendResponse(GAF.engine.status());
        return undefined;
      }
      return undefined;
    });
  }

  function formPresent(adapter) {
    try {
      const fields = GAF.fields.collect({ adapter, root: document });
      const meaningful = fields.filter((f) => f.kind !== 'checkbox' && f.kind !== 'checkboxGroup');
      return adapter.id !== 'generic' ? meaningful.length >= 1 : meaningful.length >= 3;
    } catch (_) {
      return false;
    }
  }

  function bigEnough() {
    return (window.innerWidth || 0) >= 320 && (window.innerHeight || 0) >= 240;
  }

  async function start() {
    if (GAF.util.isTestEnv() && globalThis.__GAF_NO_BOOT__) return;
    const { settings } = await globalThis.GAF_SHARED.loadAll();
    GAF.debug = !!settings.debug;
    const adapter = GAF.engine.detectAdapter();
    GAF.util.log('boot', adapter.id, isTop ? 'top' : 'frame', location.href);

    const refreshFab = GAF.util.debounce(() => {
      if (!settings.showFloatingButton || !bigEnough()) return GAF.ui.hideFab();
      if (formPresent(adapter)) GAF.ui.showFab();
    }, 1200);
    refreshFab();
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver((muts) => {
        if (muts.some((m) => m.addedNodes && m.addedNodes.length)) refreshFab();
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    const wantsAuto = () => settings.autoFillOnAtsSites && adapter.id !== 'generic' && adapter.autoFill !== false;
    if (wantsAuto()) GAF.engine.watch();

    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[globalThis.GAF_SHARED.KEYS.settings]) return;
        Object.assign(settings, globalThis.GAF_SHARED.DEFAULT_SETTINGS, changes[globalThis.GAF_SHARED.KEYS.settings].newValue || {});
        GAF.debug = !!settings.debug;
        if (wantsAuto()) GAF.engine.watch(); else GAF.engine.unwatch();
        refreshFab();
      });
    }
  }

  start().catch((e) => console.warn('[GarryAutoFill] boot failed', e));
})();
