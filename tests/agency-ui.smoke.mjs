import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
// Prueba local: Firebase, Functions, email y telemetria quedan aislados.
// XLSX_QA_PATH apunta a una copia local del mismo bundle CDN usado por la app.
const xlsxPath=process.env.XLSX_QA_PATH;
if(!xlsxPath) throw new Error('Indicá XLSX_QA_PATH con el bundle xlsx@0.18.5');
const require=createRequire(root+'/package.json');
const {chromium}=require('playwright-core');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const data=await readFile(root+'/public'+(path==='/'?'/index.html':path));res.setHeader('Content-Type',path.endsWith('.mjs')||path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const stub=`
window.fixture={passengers:[{id:'jose',lastname:'BERALDI',firstname:'JOSE',dob:'1980-01-01',gender:'M',nationality:'ARG'}],reservations:[{id:'pending',pasajeros:[],pendingPassengers:[{lastname:'BERALDI',firstname:'JOSE'}],piernas:[{fecha:'2027-01-01T12:00',vuelo:'AR123',origen:'EZE',destino:'MAD',compania:'AR'}]}]};
let pCb,rCb;
export const initDB=()=>{},setTenantContext=()=>{},getUserAgency=async()=> 'test',getAgency=async()=>({status:'active',name:'TEST',branding:{appName:'TEST'},alerts:{}});
export const listenPassengers=cb=>{pCb=cb;setTimeout(()=>cb(window.fixture.passengers),0)},listenReservations=cb=>{rCb=cb;setTimeout(()=>cb(window.fixture.reservations),0)};
export const addPassenger=async d=>{window.fixture.savedPassenger=d;window.fixture.passengers.push({id:'new',...d});pCb(window.fixture.passengers);return {id:'new'}},updatePassenger=async(id,d)=>{window.fixture.savedPassenger=d;Object.assign(window.fixture.passengers.find(p=>p.id===id),d);pCb(window.fixture.passengers)};
export const addPassengersBatch=async ds=>{window.fixture.imported=ds;return ds.map((_,i)=>'i'+i)};
export const addReservation=async d=>{window.fixture.savedReservation=d;window.fixture.reservations.push({id:'newres',...d});rCb(window.fixture.reservations);return {id:'newres'}},updateReservation=async(id,d)=>{window.fixture.savedReservation=d;Object.assign(window.fixture.reservations.find(r=>r.id===id),d);rCb(window.fixture.reservations)};
export const deletePassenger=async()=>{},isNotified=async()=>true,markNotified=async()=>{},markReservationLegsNotified=async()=>{},deleteReservation=async()=>{},deleteReservations=async()=>{},getGdsCities=async()=>[],saveGdsCities=async()=>{};`;
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 const cors={'Access-Control-Allow-Origin':url,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, GET, PATCH, OPTIONS'};
 if(u.pathname.startsWith('/.netlify/')&&route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
 if(u.hostname==='www.gstatic.com'){
  const body=u.pathname.endsWith('firebase-app.js')?'export const initializeApp=()=>({});':`const user={uid:'test',email:'test@example.invalid',getIdToken:async()=> 'dummy',getIdTokenResult:async()=>({claims:{iat:Math.floor(Date.now()/1000),auth_time:Math.floor(Date.now()/1000),role:'owner',platformAdmin:true,firebase:{sign_in_second_factor:'totp'}}})};export const getAuth=()=>({currentUser:user}),onAuthStateChanged=(_,cb)=>setTimeout(()=>cb(user),20),signOut=async()=>{},multiFactor=()=>({enrolledFactors:[{}]});`;
  return route.fulfill({contentType:'application/javascript',body});
 }
 if(u.href==='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js') return route.fulfill({contentType:'application/javascript',body:await readFile(xlsxPath,'utf8')});
 if(u.origin!==url&&!u.pathname.startsWith('/.netlify/')) return route.abort();
 if(['/js/sentry.js','/js/analytics.js'].includes(u.pathname)) return route.fulfill({contentType:'application/javascript',body:''});
 if(u.pathname==='/js/db.js')return route.fulfill({contentType:'application/javascript',body:stub});
 if(u.pathname.endsWith('/admin-api/agencies')) return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({agencies:[{id:'other',name:'Otra agencia',status:'active',plan:'trial'}]})});
 if(u.pathname.endsWith('/admin-api/agencies/other/members')) return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({members:[{uid:'other-user',email:'other@example.invalid',role:'owner',active:true}]})});
 if(u.pathname.endsWith('/mfa-admin')) {await page.evaluate(body=>{window.fixture.mfaReset=body},route.request().postDataJSON());return route.fulfill({headers:cors,contentType:'application/json',body:'{"ok":true}'});}
 if(u.pathname.startsWith('/.netlify/')) return route.fulfill({headers:cors,contentType:'application/json',body:'{"ok":true}'});
 return route.continue();
});
try{
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#app-root').style.display==='flex');
 await page.locator('#global-search').fill('jose ber');
 assert.match(await page.locator('#passengers-tbody').innerText(),/BERALDI/);
 await page.locator('#global-search').fill('ber jose');assert.match(await page.locator('#passengers-count').innerText(),/1 pasajero/);
 await page.evaluate(()=>{window.fixture.passengers[0].asistencias=[{num:'V-ANA',compania:'TEST'}];window.openEdit('jose');});
 assert.equal(await page.locator('.asistencia-num').inputValue(),'V-ANA');
 await page.evaluate(()=>{window.closeModal('modal-passenger');window.openNewPassenger();});
 assert.equal(await page.locator('#asistencia-list .asistencia-row').count(),0,'Nuevo pasajero no hereda asistencia');
 await page.evaluate(()=>window.openEdit('jose'));
 await page.locator('#emergency-add-btn').click();
 await page.locator('.emergency-name').fill('Contacto de prueba');await page.locator('.emergency-phone').fill('+5490000000000');
 await page.evaluate(()=>window.savePassenger());
 assert.equal(await page.evaluate(()=>window.fixture.savedPassenger.emergencyContact.name),'Contacto de prueba');
 await page.evaluate(()=>window.openEdit('jose'));
 assert.equal(await page.locator('.emergency-phone').inputValue(),'+5490000000000');
 await page.locator('#emergency-list button[title="Eliminar contacto"]').click();await page.evaluate(()=>window.savePassenger());
 assert.equal(await page.evaluate(()=>window.fixture.savedPassenger.emergencyContact.phone),'');
 await page.evaluate(()=>window.openEditReservation('pending'));
 assert.equal(await page.locator('#res-pax-pending').innerText(),'');
 assert.match(await page.locator('#res-pax-selected').innerText(),/BERALDI/);
 await page.evaluate(()=>window.saveReservation());
 const saved=await page.evaluate(()=>window.fixture.savedReservation);
 assert.deepEqual(saved.pasajeros,['jose']);assert.deepEqual(saved.pendingPassengers,[]);
 await page.evaluate(()=>window.showView('import'));
 await page.locator('#import-excel-input').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from('APELLIDO,NOMBRE,FECHA NAC,FFN AEROLINEA,FFN NUMERO,OBSERVACIONES,EMERGENCIA TELEFONO,ASISTENCIA COMPANIA,ASISTENCIA NUMERO\nPRUEBA,CSV,01/01/1980,AA,000123,Observacion ficticia,+5490000000000,TEST,V001')});
 await page.locator('#import-review-wrap').waitFor({state:'visible'});
 await page.locator('#btn-import-save').click();
 const imported=await page.evaluate(()=>window.fixture.imported[0]);
 assert.equal(imported.ffn[0].number,'000123');assert.equal(imported.notes,'Observacion ficticia');assert.equal(imported.emergencyContact.phone,'+5490000000000');assert.equal(imported.asistencias[0].num,'V001');
 await page.locator('#nav-admin').click();
 await page.locator('[data-agency-edit="other"]').waitFor();
 await page.locator('[data-admin-tab="users"]').click();
 await page.locator('#admin-us-filter-agency').selectOption('other');
 await page.locator('[data-user-mfa-reset="other-user"]').click({timeout:5000});
 await page.locator('#confirm-ok-btn').click();
 await page.waitForFunction(()=>window.fixture.mfaReset?.targetUid==='other-user');
 assert.deepEqual(await page.evaluate(()=>window.fixture.mfaReset),{action:'force-reset',targetUid:'other-user'});
 assert.deepEqual(errors,[]);
 console.log('PASS browser: search, optional emergency roundtrip, pending linkage, real CSV parser to save, platform MFA reset across agencies; no external services');
}catch(e){console.error('Browser errors',errors);console.error('Toast',await page.locator('#toast-text').innerText());throw e;}finally{await browser.close();server.close();}
