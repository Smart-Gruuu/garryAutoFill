/* Garry AutoFill - UKG Pro adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'ukg',
    name: 'UKG Pro',
    match: ({ host }) => /(^|.)(ultipro\.com|ukg\.net)$/.test(host),
  });
})();
