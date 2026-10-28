/* Garry AutoFill - Oracle Recruiting Cloud adapter (placeholder: host detection only). */
(function () {
  'use strict';
  const GAF = globalThis.GAF;
  if (!GAF || !GAF.registerAdapter) return;
  GAF.registerAdapter({
    id: 'oracle',
    name: 'Oracle Recruiting Cloud',
    match: ({ host }) => /(^|.)oraclecloud\.com$/.test(host),
  });
})();
