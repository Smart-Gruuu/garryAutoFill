/* Garry AutoFill - BambooHR adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'bamboohr',
    name: 'BambooHR',
    match: ({ host }) => /(^|.)bamboohr\.com$/.test(host),
  });
})();
