// Compara tiempos de Chrome (FCP, LCP, JS local) entre dos carpetas public/.
// Default: Fast 3G + CPU 4x (mismo perfil mobile de Lighthouse), 3 runs, mediana.
// Sin dependencias: Chrome local + CDP.
//   git worktree add /tmp/td-perf-before HEAD~1
//   npm run measure:perf -- --before /tmp/td-perf-before/public --after public
//   node scripts/measure-perf.mjs --url https://traveldocs.com.ar --no-throttle
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGES = ['/landing.html', '/login.html', '/index.html'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function hasFlag(name) {
  return process.argv.includes(name);
}
function median(xs) {
  const s = xs.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function cacheHeader(urlPath, honorHeaders) {
  if (!honorHeaders) return 'public, max-age=0, must-revalidate';
  if (urlPath.startsWith('/js/')) return 'public, max-age=60, stale-while-revalidate=604800';
  if (urlPath.startsWith('/css/')) return 'public, max-age=60, stale-while-revalidate=604800';
  if (urlPath.startsWith('/assets/')) return 'public, max-age=86400, stale-while-revalidate=604800';
  return 'public, max-age=0, must-revalidate';
}

function serve(root, honorHeaders) {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = normalize(join(root, urlPath === '/' ? '/index.html' : urlPath));
      if (!file.startsWith(normalize(root))) {
        res.writeHead(403); res.end(); return;
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': cacheHeader(urlPath, honorHeaders),
      });
      res.end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

async function waitHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* chrome still booting */ }
    await sleep(100);
  }
  throw new Error('Chrome DevTools no arranco: ' + url);
}

function attachCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { res, rej }));
        },
        on(fn) { listeners.push(fn); },
        close() { ws.close(); },
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message || JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        listeners.forEach(fn => fn(msg));
      }
    });
  });
}

async function measureOnce(cdp, pageUrl, { disableCache, throttle }) {
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: disableCache });
  if (disableCache) await cdp.send('Network.clearBrowserCache');
  if (throttle) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: Math.round(1.6 * 1024 * 1024 / 8),
      uploadThroughput: Math.round(750 * 1024 / 8),
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  // index.html redirige a login si no hay sesion: abortamos esa ida
  // para medir el boot de la SPA (app.mjs) y no el de login.html.
  if (/\/index\.html$/i.test(pageUrl)) {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*login.html*' }] });
    cdp.on(msg => {
      if (msg.method === 'Fetch.requestPaused') {
        cdp.send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'Aborted' });
      }
    });
  }

  const inflight = new Set();
  const reqUrl = new Map();
  let transferred = 0;
  let localJs = 0;
  let requests = 0;
  const origin = new URL(pageUrl).origin;
  cdp.on(msg => {
    if (msg.method === 'Network.requestWillBeSent') {
      inflight.add(msg.params.requestId);
      reqUrl.set(msg.params.requestId, msg.params.request?.url || '');
      requests++;
    }
    if (msg.method === 'Network.loadingFinished') {
      inflight.delete(msg.params.requestId);
      const n = msg.params.encodedDataLength || 0;
      transferred += n;
      const u = reqUrl.get(msg.params.requestId) || '';
      if (u.startsWith(origin) && /\.m?js(\?|$)/i.test(u)) localJs += n;
    }
    if (msg.method === 'Network.loadingFailed') inflight.delete(msg.params.requestId);
  });

  const loaded = new Promise(resolve => {
    cdp.on(msg => { if (msg.method === 'Page.loadEventFired') resolve(); });
  });
  await cdp.send('Page.navigate', { url: pageUrl });
  await Promise.race([loaded, sleep(20000)]);
  const idleStart = Date.now();
  while (inflight.size && Date.now() - idleStart < 8000) await sleep(100);
  await sleep(400);

  const evaled = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');
      const lcps = performance.getEntriesByType('largest-contentful-paint');
      const scripts = performance.getEntriesByType('resource').filter(r =>
        r.initiatorType === 'script' || /\\.m?js(\\?|$)/.test(r.name)
      );
      const localScripts = scripts.filter(r => r.name.startsWith(location.origin));
      return {
        fcp: fcp ? fcp.startTime : null,
        lcp: lcps.length ? lcps[lcps.length - 1].startTime : null,
        dcl: nav ? nav.domContentLoadedEventEnd : null,
        load: nav ? nav.loadEventEnd : null,
        localJs: localScripts.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0),
        jsDone: localScripts.reduce((n, r) => Math.max(n, r.responseEnd || 0), 0),
        transfer: performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0) + (nav ? nav.transferSize || 0 : 0)
      };
    })()`,
    returnByValue: true,
  });
  const v = evaled.result?.value || {};
  return {
    fcp: v.fcp,
    lcp: v.lcp || v.fcp,
    dcl: v.dcl,
    load: v.load,
    localJs: Math.max(v.localJs || 0, localJs),
    jsDone: v.jsDone,
    transfer: Math.max(v.transfer || 0, transferred),
    requests,
  };
}

async function withChrome(fn) {
  if (!existsSync(CHROME)) throw new Error('No esta Google Chrome en /Applications');
  const profile = mkdtempSync(join(tmpdir(), 'td-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  let port = 0;
  try {
    const t0 = Date.now();
    while (!existsSync(portFile)) {
      if (Date.now() - t0 > 15000) throw new Error('Chrome no publico DevTools');
      await sleep(50);
    }
    port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
    await waitHttp(`http://127.0.0.1:${port}/json/version`);
    await fn(port);
  } finally {
    proc.kill('SIGKILL');
    rmSync(profile, { recursive: true, force: true });
  }
}

async function newPage(debugPort) {
  const tab = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
  return attachCdp(tab.webSocketDebuggerUrl);
}

function summarize(samples) {
  return {
    fcp: median(samples.map(s => s.fcp)),
    lcp: median(samples.map(s => s.lcp)),
    load: median(samples.map(s => s.load)),
    jsDone: median(samples.map(s => s.jsDone)),
    localJs: median(samples.map(s => s.localJs)),
    transfer: median(samples.map(s => s.transfer)),
    requests: median(samples.map(s => s.requests)),
  };
}

async function runOne(debugPort, url, throttle) {
  const cdp = await newPage(debugPort);
  try {
    return await measureOnce(cdp, url, { disableCache: true, throttle });
  } finally {
    cdp.close();
  }
}

async function measurePair(debugPort, beforeBase, afterBase, pages, runs, throttle) {
  const before = {};
  const after = {};
  await runOne(debugPort, (afterBase || beforeBase) + pages[0], throttle);
  for (const page of pages) {
    const beforeSamples = [];
    const afterSamples = [];
    for (let i = 0; i < runs; i++) {
      if (beforeBase) beforeSamples.push(await runOne(debugPort, beforeBase + page, throttle));
      if (afterBase) afterSamples.push(await runOne(debugPort, afterBase + page, throttle));
    }
    if (beforeSamples.length) before[page] = summarize(beforeSamples);
    if (afterSamples.length) after[page] = summarize(afterSamples);
  }
  return { before, after };
}

function fmt(n, kind) {
  if (n == null) return 'n/a';
  if (kind === 'bytes') {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(n / 1024) + ' KB';
  }
  return Math.round(n) + ' ms';
}

function delta(a, b, kind) {
  if (a == null || b == null) return '';
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return sign + fmt(d, kind);
}

function printTable(before, after) {
  const metrics = [
    ['fcp', 'ms', 'FCP'],
    ['lcp', 'ms', 'LCP'],
    ['load', 'ms', 'load'],
    ['jsDone', 'ms', 'JS local done'],
    ['localJs', 'bytes', 'JS local'],
    ['transfer', 'bytes', 'transfer'],
    ['requests', 'ms', 'requests'],
  ];
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('pagina', 16) + pad('metric', 14) + pad('antes', 12) + pad('despues', 12) + 'delta');
  for (const page of Object.keys(after)) {
    for (const [key, kind, label] of metrics) {
      const a = before?.[page]?.[key];
      const b = after[page][key];
      const kindFmt = key === 'requests' ? null : kind;
      const fa = key === 'requests' ? (a == null ? 'n/a' : String(a)) : fmt(a, kindFmt);
      const fb = key === 'requests' ? (b == null ? 'n/a' : String(b)) : fmt(b, kindFmt);
      const d = key === 'requests'
        ? (a == null || b == null ? '' : (b - a > 0 ? '+' : '') + (b - a))
        : delta(a, b, kindFmt);
      console.log(pad(page, 16) + pad(label, 14) + pad(fa, 12) + pad(fb, 12) + d);
    }
  }
}

const beforeRoot = arg('--before');
const afterRoot = arg('--after');
const url = arg('--url');
const runs = Number(arg('--runs', '3'));
const throttle = !hasFlag('--no-throttle');

if (!url && !afterRoot) {
  console.error('Uso: node scripts/measure-perf.mjs --before <public-antes> --after <public-despues>');
  console.error('  o:  node scripts/measure-perf.mjs --url https://traveldocs.com.ar');
  console.error('Red: Fast 3G + CPU 4x (Lighthouse mobile). Sacar con --no-throttle.');
  process.exit(1);
}

await withChrome(async debugPort => {
  if (url) {
    const { after } = await measurePair(debugPort, null, url.replace(/\/$/, ''), PAGES, runs, throttle);
    printTable(null, after);
    return;
  }
  let beforeSrv, afterSrv;
  try {
    afterSrv = await serve(afterRoot, true);
    beforeSrv = beforeRoot ? await serve(beforeRoot, false) : null;
    const beforeBase = beforeSrv ? `http://127.0.0.1:${beforeSrv.port}` : null;
    const afterBase = `http://127.0.0.1:${afterSrv.port}`;
    console.error(throttle ? 'throttle: Fast 3G + CPU 4x, median de ' + runs + ' runs, intercalado' : 'throttle: off');
    const { before, after } = await measurePair(debugPort, beforeBase, afterBase, PAGES, runs, throttle);
    printTable(before, after);
  } finally {
    beforeSrv?.close();
    afterSrv?.close();
  }
});
