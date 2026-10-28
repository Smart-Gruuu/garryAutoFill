/* Garry AutoFill - Greenhouse adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'greenhouse',
    name: 'Greenhouse',
    match: ({ host }) => /(^|.)greenhouse\.io$/.test(host),
  });
})();
