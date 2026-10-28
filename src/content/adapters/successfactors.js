/* Garry AutoFill - SAP SuccessFactors adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'successfactors',
    name: 'SAP SuccessFactors',
    match: ({ host }) => /(^|.)(successfactors\.(com|eu)|sapsf\.(com|eu))$/.test(host),
  });
})();
