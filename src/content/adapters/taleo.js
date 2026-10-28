/* Garry AutoFill - Taleo adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'taleo',
    name: 'Taleo',
    match: ({ host }) => /(^|.)taleo\.net$/.test(host),
  });
})();
