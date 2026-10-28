/* Garry AutoFill - SmartRecruiters adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    match: ({ host }) => /(^|.)smartrecruiters\.com$/.test(host),
  });
})();
