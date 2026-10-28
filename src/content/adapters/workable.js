/* Garry AutoFill - Workable adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'workable',
    name: 'Workable',
    match: ({ host }) => /(^|.)workable\.com$/.test(host),
  });
})();
