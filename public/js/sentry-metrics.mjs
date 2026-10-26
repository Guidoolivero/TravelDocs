export function pageName(pathname) {
  const p = String(pathname || '');
  if (p.endsWith('login.html')) return 'login';
  if (p.endsWith('landing.html') || p === '/' || p === '') return 'landing';
  return 'app';
}

export function pageLoadMetrics(perf) {
  const nav = perf.getEntriesByType('navigation')[0];
  const fcp = perf.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
  const lcps = perf.getEntriesByType('largest-contentful-paint') || [];
  return {
    fcp: fcp ? fcp.startTime : null,
    lcp: lcps.length ? lcps[lcps.length - 1].startTime : null,
    load: nav ? nav.loadEventEnd : null,
  };
}

export function reportPageLoad(metricsApi, perf, pathname) {
  if (!metricsApi) return;
  const attributes = { page: pageName(pathname) };
  metricsApi.count('page.view', 1, { attributes });
  const m = pageLoadMetrics(perf);
  if (m.fcp != null) metricsApi.distribution('page.fcp', m.fcp, { unit: 'millisecond', attributes });
  if (m.lcp != null) metricsApi.distribution('page.lcp', m.lcp, { unit: 'millisecond', attributes });
  if (m.load != null) metricsApi.distribution('page.load', m.load, { unit: 'millisecond', attributes });
}

// Log estructurado: mensaje estable + atributos planos. Sin path, email ni docs.
export function reportPageLog(logger, pathname) {
  if (!logger || typeof logger.info !== 'function') return;
  logger.info('page.loaded', { page: pageName(pathname) });
}
