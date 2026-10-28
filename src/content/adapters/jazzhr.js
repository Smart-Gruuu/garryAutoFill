/* Garry AutoFill - JazzHR adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'jazzhr',
    name: 'JazzHR',
    match: ({ host }) => /(^|.)(applytojob|jazzhr)\.com$/.test(host),
  });
})();
