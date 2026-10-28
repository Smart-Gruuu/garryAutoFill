/* Garry AutoFill - Jobvite adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'jobvite',
    name: 'Jobvite',
    match: ({ host }) => /(^|.)jobvite\.com$/.test(host),
  });
})();
