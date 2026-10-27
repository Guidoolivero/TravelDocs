// Prueba de navegador local: Firebase, QR y Functions se simulan; no usa credenciales.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const root = process.env.PUBLIC_DIR ? pathToFileURL(process.env.PUBLIC_DIR + '/') : new URL('../public/', import.meta.url);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Content-Type', /\.(js|mjs)$/.test(path) ? 'application/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(new URL('.' + path, root)));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined), headless: true });
try {
  for (const scenario of ['enrollment', 'single-factor', 'totp']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const js = body => route.fulfill({ contentType: 'application/javascript', body });
      if (url.hostname === 'www.gstatic.com') {
        if (url.pathname.endsWith('firebase-app.js')) return js('export const initializeApp=()=>({});');
        return js(`
          let enrolled=${scenario !== 'enrollment'};
          const user={uid:'test',email:'test@example.invalid',getIdToken:async()=> 'dummy',getIdTokenResult:async()=>({claims:{firebase:${scenario === 'totp' ? "{sign_in_second_factor:'totp'}" : '{}'}}})};
          export const getAuth=()=>({currentUser:user}), onAuthStateChanged=(_,fn)=>setTimeout(()=>fn(user),10),signOut=async()=>{window.signedOut=true;};
          export const multiFactor=()=>({enrolledFactors:enrolled?[{factorId:'totp'}]:[],getSession:async()=>({}),enroll:async()=>{enrolled=true;}});
          export const TotpMultiFactorGenerator={generateSecret:async()=>({generateQrCodeUrl:()=> 'test-qr'}),assertionForEnrollment:()=>({})};
          export const getMultiFactorResolver=()=>({}),signInWithEmailAndPassword=async()=>({user});
        `);
      }
      if (url.href.startsWith('https://cdn.jsdelivr.net/npm/qrcode')) return js('export default {toCanvas:async()=>{}};');
      if (url.pathname === '/.netlify/functions/mfa-complete') return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '{"recoveryCodes":["TEST-RECOVERY-CODE"]}' });
      if (url.origin !== origin) return route.abort();
      if (/\/(sentry|analytics)\.js$/.test(url.pathname)) return js('');
      if (url.pathname === '/index.html') return route.fulfill({ contentType: 'text/html', body: '<p>Ingreso validado</p>' });
      if (url.pathname.endsWith('/db.js')) return js('export const initDB=()=>{},getUserAgency=async()=> "agency",getAgency=async()=>{window.agencyReads=(window.agencyReads||0)+1;return {status:"active"};};');
      if (url.pathname.endsWith('/tenant.js')) return js('export const storeAgencyId=()=>{},clearStoredAgencyId=()=>{},getStoredAgencyId=()=>null,applyBranding=()=>{};');
      return route.continue();
    });
    await page.goto(origin + '/login.html');
    if (scenario === 'totp') {
      await page.waitForURL('**/index.html');
    } else {
      if (scenario === 'enrollment') {
        await page.locator('#mfa-setup-panel').waitFor({ state: 'visible' });
        await page.locator('#mfa-enroll-code').fill('123456');
        await page.locator('#btn-mfa-enroll').click();
        await page.locator('#recovery-codes-view').waitFor({ state: 'visible' });
        await page.locator('#btn-recovery-done').click();
      }
      await page.getByText('Ingresa nuevamente con tu contrasena', { exact: false }).waitFor();
      assert.equal(await page.evaluate(() => window.signedOut), true);
      assert.equal(await page.evaluate(() => window.agencyReads || 0), 0);
      assert.equal(await page.locator('#login-form').isVisible(), true);
    }
    assert.deepEqual(errors, []);
    console.log('PASS browser MFA:', scenario);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
