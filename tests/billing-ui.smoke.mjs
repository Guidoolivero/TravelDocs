import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildDraftDocument, renderTravelDocsPdf } from '../netlify/functions/lib/invoice-pdf.cjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const environment = process.env.BILLING_UI_ENVIRONMENT || 'test';
const { chromium, webkit, devices } = createRequire(import.meta.url)('playwright-core');
const browserType = process.env.BILLING_UI_BROWSER === 'webkit' ? webkit : chromium;
const pdfVersion = (await readFile(root + 'public/js/app.mjs', 'utf8')).match(/PDFJS_VER = '([^']+)'/)[1];
const pdfBase = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfVersion}/build/`;
const pdfAssets = Object.fromEntries(await Promise.all(['pdf.min.mjs', 'pdf.worker.min.mjs'].map(async name => {
  const response = await fetch(pdfBase + name, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
  return [pdfBase + name, await response.text()];
})));
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const data = await readFile((process.env.PUBLIC_DIR || root + 'public') + (path === '/' ? '/index.html' : path));
    res.setHeader('Content-Type', /\.(mjs|js)$/.test(path) ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    if (path === '/' || path.endsWith('.html')) res.setHeader('Content-Security-Policy', (await readFile(root + 'public/_headers', 'utf8')).match(/^  Content-Security-Policy: (.+)$/m)[1]);
    res.end(data);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await browserType.launch({ executablePath: browserType === chromium ? process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined) : undefined, headless: true });
const page = await browser.newPage(process.env.BILLING_UI_DEVICE === 'ipad' ? devices['iPad Pro 11'] : { viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const agencies = Array.from({ length: 5 }, (_, i) => ({ id: 'prueba-' + i, name: 'Agencia de prueba ' + i, status: 'active', plan: 'trial', createdAt: '2026-10-21', billing: {}, billingStatus: { state: 'trial', trialEndsOn: '2026-11-20', firstPeriod: '2026-12' } }));
const draft = { environment, id: 'a'.repeat(64), digest: 'b'.repeat(64), agencyId: 'prueba-0', period: '2026-11', status: 'draft',
  issuer: { legalName: 'Emisor ficticio', taxId: '20123456786', address: 'Calle 100', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' },
  receiver: { legalName: 'Agencia ficticia', taxId: '20123456786', address: 'Calle 1', condition: 'monotributo' },
  input: { currency: 'ARS', date: '2026-11-02', salesPoint: 2, service: { from: '2026-11-02', to: '2026-11-02', dueDate: '2026-11-02' }, items: [{ description: 'Servicio TravelDocs', quantity: 1, unitPrice: '100.00', amount: 10000 }] } };
let saved, issues = 0, previews = 0, failPreview = true;
await page.route('**/*', async route => {
  const u = new URL(route.request().url()), method = route.request().method();
  const cors = { 'Access-Control-Allow-Origin': url, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS' };
  const json = value => route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(value) });
  if (pdfAssets[u.href]) return route.fulfill({ headers: cors, contentType: 'application/javascript', body: pdfAssets[u.href] });
  if (u.pathname.startsWith('/.netlify/')) {
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/admin-api/agencies') && method === 'GET') return json({ billingEnabled: true, billingEnvironment: environment, agencies });
    if (u.pathname.includes('/admin-api/agencies') && ['POST', 'PATCH'].includes(method)) { saved = route.request().postDataJSON(); return json({ ok: true }); }
    if (u.pathname.endsWith('/billing-pdf')) {
      const preview = route.request().postDataJSON().preview === true;
      const pdf = await renderTravelDocsPdf(buildDraftDocument(draft), { draft: true, period: draft.period, notice: 'BORRADOR - SIN VALOR FISCAL' });
      return json({ pdf: pdf.toString('base64'), preview, filename: preview ? 'borrador-factura-C-2026-11.pdf' : 'prueba-factura-C-00001-00000001.pdf' });
    }
    if (u.pathname.endsWith('/billing-api')) {
      const body = route.request().postDataJSON();
      if (body.action === 'list') return json({ invoices: previews ? [draft] : [] });
      if (body.action === 'preview' && failPreview) { failPreview = false; return route.abort('failed'); }
      if (body.action === 'preview') { previews++; draft.receiver.saleCondition = body.saleCondition; return json(draft); }
      if (body.action === 'issue') { issues++; draft.status = 'issuing'; return route.fulfill({ status: 503, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: 'No pudimos obtener una respuesta de ARCA. La factura podria haberse autorizado. Usa Consultar ARCA antes de reintentar.' }) }); }
      if (body.action === 'recover') { draft.status = 'authorized'; return json(draft); }
    }
    return json({ ok: true });
  }
  if (u.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'application/javascript', body: u.pathname.endsWith('firebase-app.js') ? 'export const initializeApp=()=>({});' : `const user={uid:'test',email:'test@example.invalid',getIdToken:async()=> 'dummy',getIdTokenResult:async()=>({claims:{iat:Math.floor(Date.now()/1000),auth_time:Math.floor(Date.now()/1000),role:'owner',platformAdmin:true,firebase:{sign_in_second_factor:'totp'}}})};export const getAuth=()=>({currentUser:user}),onAuthStateChanged=(_,cb)=>setTimeout(()=>cb(user),20),signOut=async()=>{},multiFactor=()=>({enrolledFactors:[{}]});` });
  if (u.origin !== url) return route.abort();
  // El servidor de funciones local del smoke usa el mismo origen, como produccion.
  if (u.pathname.endsWith('/app.mjs')) return route.fulfill({ contentType: 'application/javascript', body: (await readFile((process.env.PUBLIC_DIR || root + 'public') + u.pathname, 'utf8')).replace('http://localhost:8888/.netlify/functions/admin-api', url + '/.netlify/functions/admin-api') });
  if (/\/(sentry|analytics)\.js$/.test(u.pathname)) return route.fulfill({ contentType: 'application/javascript', body: '' });
  if (u.pathname.endsWith('/db.js')) return route.fulfill({ contentType: 'application/javascript', body: `export const initDB=()=>{},setTenantContext=()=>{},getUserAgency=async()=> 'test',getAgency=async()=>({status:'active',name:'TEST',branding:{appName:'TEST'},alerts:{}}),listenPassengers=cb=>setTimeout(()=>cb([]),0),listenReservations=cb=>setTimeout(()=>cb([]),0),addPassenger=async()=>{},addPassengersBatch=async()=>[],updatePassenger=async()=>{},deletePassenger=async()=>{},isNotified=async()=>true,markNotified=async()=>{},addReservation=async()=>{},updateReservation=async()=>{},deleteReservation=async()=>{},deleteReservations=async()=>{},getGdsCities=async()=>[],saveGdsCities=async()=>{},markReservationLegsNotified=async()=>{};` });
  return route.continue();
});
try {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#app-root').style.display === 'flex');
  await page.evaluate(() => { window.showView('admin'); window.setAdminTab('agencies'); });
  await page.locator('[data-agency-edit="prueba-0"]').waitFor();
  assert.equal(await page.locator('[data-billing-preview]').count(), 0);
  assert.equal((await page.locator('#admin-agencies-tbody').innerText()).match(/Prueba gratis hasta/g).length, 5);
  await page.locator('[data-agency-edit="prueba-0"]').click();
  assert.equal(await page.locator('#admin-billing-fields').evaluate(el => el.open), false);
  assert.equal(await page.locator('#admin-bill-legalName').isVisible(), false);
  await page.locator('#admin-billing-fields summary').focus();
  await page.keyboard.press('Enter');
  await page.locator('#admin-bill-legalName').fill('Agencia ficticia');
  await page.locator('#admin-ag-save').click();
  await page.waitForFunction(() => document.querySelector('#admin-agency-edit-id').value === '');
  assert.equal(saved.billing.legalName, 'Agencia ficticia');
  assert.equal(saved.billing.amount, null);
  assert.equal(saved.billing.saleCondition, 'Transferencia bancaria');
  await page.locator('[data-agency-edit="prueba-0"]').click();
  await page.locator('#admin-billing-fields summary').click();
  await page.locator('#admin-bill-saleCondition').selectOption('Cuenta corriente');
  await page.locator('#admin-bill-amount').fill('100,25');
  await page.locator('#admin-ag-save').click();
  await page.waitForFunction(() => document.querySelector('#admin-agency-edit-id').value === '');
  assert.equal(saved.billing.amount, 10025);
  assert.equal(saved.billing.saleCondition, 'Cuenta corriente');
  agencies[0].billingStatus.state = 'ready';
  assert.equal(await page.locator('#admin-billing-history').isVisible(), false);
  await page.locator('[data-admin-tab="billing"]').click();
  await page.locator('#admin-panel-billing').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#admin-panel-agencies').isVisible(), false);
  await page.locator('[data-billing-condition="prueba-0"]').selectOption('Cheque');
  assert.equal(await page.locator('[data-billing-preview="prueba-0"]').innerText(), 'Vista previa');
  await page.locator('[data-billing-preview="prueba-0"]').click();
  await page.locator('#admin-billing-feedback').waitFor({ state: 'visible' });
  assert.match(await page.locator('#admin-billing-feedback').innerText(), /Revisa tu conexion/);
  assert.equal(issues, 0);
  await page.locator('[data-billing-preview="prueba-0"]').click();
  await page.locator('#billing-preview-dialog[open]').waitFor();
  await page.locator('#billing-preview-canvas canvas').waitFor();
  assert.ok(await page.locator('#billing-preview-canvas canvas').evaluate(el => el.width > 500));
  assert.match(await page.locator('#billing-preview-download').getAttribute('href'), /^blob:/);
  assert.equal(await page.locator('#billing-preview-download').getAttribute('download'), 'borrador-factura-C-2026-11.pdf');
  assert.match(await page.locator('#billing-preview-dialog').innerText(), /Vista previa/);
  assert.equal(issues, 0);
  assert.match(await page.locator('#billing-preview-dialog').innerText(), environment === 'production' ? /Emitir factura real/ : /Emitir prueba/);
  assert.match(await page.locator('#admin-billing-history').innerText(), environment === 'production' ? /Facturas reales/ : /homologacion/);
  assert.match(await page.locator('#billing-preview-summary').innerText(), /Agencia ficticia/);
  assert.match(await page.locator('#billing-preview-summary').innerText(), /Cheque/);
  const draftDownload = page.waitForEvent('download');
  await page.locator('#billing-preview-download').click();
  assert.equal((await draftDownload).suggestedFilename(), 'borrador-factura-C-2026-11.pdf');
  assert.equal(issues, 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#billing-preview-dialog[open]').count(), 0);
  await page.locator('[data-billing-preview="prueba-0"]').click();
  await page.locator('#billing-preview-canvas canvas').waitFor();
  if (process.env.BILLING_UI_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_UI_SCREENSHOT.replace(/\.png$/, '-preview.png') });
  await page.locator('#billing-preview-issue').click();
  await page.locator('[data-billing-recover]').waitFor();
  assert.match(await page.locator('#admin-billing-feedback').innerText(), /podria haberse autorizado/);
  if (process.env.BILLING_UI_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_UI_SCREENSHOT.replace(/\.png$/, '-error.png'), fullPage: true });
  assert.match(await page.locator('#admin-billing-tbody').innerText(), /Consultar ARCA/);
  assert.equal(issues, 1);
  await page.locator('[data-billing-recover]').click();
  await page.locator('[data-billing-pdf]').waitFor();
  assert.equal(await page.locator('#admin-billing-feedback').isVisible(), false);
  assert.equal(issues, 1);
  const downloading = page.waitForEvent('download');
  await page.locator('[data-billing-pdf]').click();
  assert.equal((await downloading).suggestedFilename(), 'prueba-factura-C-00001-00000001.pdf');
  assert.equal(issues, 1, 'Descargar no vuelve a emitir');
  await page.locator('[data-billing-preview="prueba-0"]').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('ya esta autorizada'));
  assert.equal(await page.locator('#modal-confirm.open').count(), 0);
  assert.equal(issues, 1, 'Consultar factura emitida no vuelve a confirmar ni emitir');
  if (process.env.BILLING_UI_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_UI_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Billing UI: ficha parcial, centavos, cinco pruebas gratis y confirmacion de emision OK');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
