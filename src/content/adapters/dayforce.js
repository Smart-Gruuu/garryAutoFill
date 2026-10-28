/* Garry AutoFill - Dayforce adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'dayforce',
    name: 'Dayforce',
    match: ({ host }) => /(^|.)dayforcehcm\.com$/.test(host),
  });
})();
