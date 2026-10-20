import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pageName, pageLoadMetrics, reportPageLoad } from '../public/js/sentry-metrics.mjs';

describe('pageName', () => {
  it('login, landing y app segun el path', () => {
    assert.equal(pageName('/login.html'), 'login');
    assert.equal(pageName('/landing.html'), 'landing');
    assert.equal(pageName('/'), 'landing');
    assert.equal(pageName('/index.html'), 'app');
    assert.equal(pageName('/pasajeros'), 'app');
  });
});

describe('pageLoadMetrics', () => {
  it('lee FCP, LCP y load de Performance', () => {
    const perf = {
      getEntriesByType(type) {
        if (type === 'navigation') return [{ loadEventEnd: 2100 }];
        if (type === 'paint') return [{ name: 'first-contentful-paint', startTime: 420 }];
        if (type === 'largest-contentful-paint') return [{ startTime: 800 }, { startTime: 950 }];
        return [];
      }
    };
    assert.deepEqual(pageLoadMetrics(perf), { fcp: 420, lcp: 950, load: 2100 });
  });
});

describe('reportPageLoad', () => {
  it('manda count de page.view y distributions en ms', () => {
    const calls = [];
    const api = {
      count(...args) { calls.push(['count', ...args]); },
      distribution(...args) { calls.push(['distribution', ...args]); },
    };
    const perf = {
      getEntriesByType(type) {
        if (type === 'navigation') return [{ loadEventEnd: 180 }];
        if (type === 'paint') return [{ name: 'first-contentful-paint', startTime: 90 }];
        if (type === 'largest-contentful-paint') return [{ startTime: 120 }];
        return [];
      }
    };
    reportPageLoad(api, perf, '/login.html');
    const attrs = { attributes: { page: 'login' } };
    assert.deepEqual(calls[0], ['count', 'page.view', 1, attrs]);
    assert.equal(calls[1][0], 'distribution');
    assert.equal(calls[1][1], 'page.fcp');
    assert.equal(calls[1][2], 90);
    assert.equal(calls[1][3].unit, 'millisecond');
    assert.equal(calls[1][3].attributes.page, 'login');
  });
});
