/* Garry AutoFill - Paylocity adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'paylocity',
    name: 'Paylocity',
    match: ({ host }) => /(^|.)paylocity\.com$/.test(host),
  });
})();
