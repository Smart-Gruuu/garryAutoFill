/* Garry AutoFill - Ashby adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'ashby',
    name: 'Ashby',
    match: ({ host }) => /(^|.)ashbyhq\.com$/.test(host),
  });
})();
