/* Garry AutoFill - ADP adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'adp',
    name: 'ADP',
    match: ({ host }) => /(^|.)adp\.com$/.test(host),
  });
})();
