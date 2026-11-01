import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright-core');
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const data = await readFile((process.env.PUBLIC_DIR || root + 'public') + (path === '/' ? '/index.html' : path));
    res.setHeader('Content-Type', /\.(mjs|js)$/.test(path) ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(data);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const agencies = Array.from({ length: 5 }, (_, i) => ({ id: 'prueba-' + i, name: 'Agencia de prueba ' + i, status: 'active', plan: 'trial', createdAt: '2026-10-21', billing: {}, billingStatus: { state: 'trial', trialEndsOn: '2026-11-20', firstPeriod: '2026-12' } }));
const draft = { id: 'a'.repeat(64), digest: 'approved', agencyId: 'prueba-0', period: '2026-11', status: 'draft', receiver: { legalName: 'Agencia ficticia', taxId: '20123456786', address: 'Calle 1', condition: 'monotributo' }, input: { currency: 'ARS', date: '2026-11-02', items: [{ amount: 10000 }] } };
let saved, issues = 0, previews = 0;
await page.route('**/*', async route => {
  const u = new URL(route.request().url()), method = route.request().method();
  const cors = { 'Access-Control-Allow-Origin': url, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, PATCH, OPTIONS' };
  const json = value => route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify(value) });
  if (u.pathname.startsWith('/.netlify/')) {
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/admin-api/agencies') && method === 'GET') return json({ billingEnabled: true, agencies });
    if (u.pathname.includes('/admin-api/agencies') && ['POST', 'PATCH'].includes(method)) { saved = route.request().postDataJSON(); return json({ ok: true }); }
    if (u.pathname.endsWith('/billing-pdf')) return json({ pdf: Buffer.from('%PDF-1.4\nfixture').toString('base64'), filename: 'prueba-factura-C-00001-00000001.pdf' });
    if (u.pathname.endsWith('/billing-api')) {
      const body = route.request().postDataJSON();
      if (body.action === 'list') return json({ invoices: previews ? [draft] : [] });
      if (body.action === 'preview') { previews++; draft.receiver.saleCondition = body.saleCondition; return json(draft); }
      if (body.action === 'issue') { issues++; draft.status = 'authorized'; return json(draft); }
    }
    return json({ ok: true });
  }
  if (u.hostname === 'www.gstatic.com') return route.fulfill({ contentType: 'application/javascript', body: u.pathname.endsWith('firebase-app.js') ? 'export const initializeApp=()=>({});' : `const user={uid:'test',email:'test@example.invalid',getIdToken:async()=> 'dummy',getIdTokenResult:async()=>({claims:{iat:Math.floor(Date.now()/1000),auth_time:Math.floor(Date.now()/1000),role:'owner',platformAdmin:true,firebase:{sign_in_second_factor:'totp'}}})};export const getAuth=()=>({currentUser:user}),onAuthStateChanged=(_,cb)=>setTimeout(()=>cb(user),20),signOut=async()=>{},multiFactor=()=>({enrolledFactors:[{}]});` });
  if (u.origin !== url) return route.abort();
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
  await page.locator('[data-billing-preview="prueba-0"]').click();
  await page.locator('#modal-confirm.open').waitFor();
  assert.equal(issues, 0);
  assert.match(await page.locator('#confirm-text').innerText(), /Agencia ficticia/);
  assert.match(await page.locator('#confirm-text').innerText(), /Concepto: Servicios/);
  assert.match(await page.locator('#confirm-text').innerText(), /Condicion de venta: Cheque/);
  await page.locator('#confirm-ok-btn').click();
  await page.locator('[data-billing-pdf]').waitFor();
  assert.equal(issues, 1);
  const downloading = page.waitForEvent('download');
  await page.locator('[data-billing-pdf]').click();
  assert.equal((await downloading).suggestedFilename(), 'prueba-factura-C-00001-00000001.pdf');
  assert.equal(issues, 1, 'Descargar no vuelve a emitir');
  if (process.env.BILLING_UI_SCREENSHOT) await page.screenshot({ path: process.env.BILLING_UI_SCREENSHOT, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Billing UI: ficha parcial, centavos, cinco pruebas gratis y confirmacion de emision OK');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
