/* Garry AutoFill - Lever adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'lever',
    name: 'Lever',
    match: ({ host }) => /(^|.)lever\.co$/.test(host),
  });
})();
