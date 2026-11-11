import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
// Prueba local: Firebase, Functions, email y telemetria quedan aislados.
// XLSX_QA_PATH apunta a una copia local del mismo bundle CDN usado por la app.
const publicDir=process.env.PUBLIC_DIR || root+'/public';
const xlsxPath=process.env.XLSX_QA_PATH;
if(!xlsxPath) throw new Error('Indicá XLSX_QA_PATH con el bundle xlsx@0.18.5');
const require=createRequire(root+'/package.json');
const {chromium}=require('playwright-core');
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const data=await readFile(publicDir+(path==='/'?'/index.html':path));res.setHeader('Content-Type',path.endsWith('.mjs')||path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
const previousIds=[...(await readFile(publicDir+'/index.html','utf8')).matchAll(/data-update-id="([^"]+)"/g)].map(m=>m[1]);
const previousReads=['test','otro'].flatMap(uid=>previousIds.map(id=>`platform-update_${uid}_${id}`));
const legacyReadCount=previousReads.length;
const page=await browser.newPage();const notifications=new Set(previousReads);let failRead=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
const stub=`
window.fixture={passengers:[{id:'jose',lastname:'BERALDI',firstname:'JOSE',dob:'1980-01-01',gender:'M',nationality:'ARG'}],reservations:[{id:'pending',pasajeros:[],pendingPassengers:[{lastname:'BERALDI',firstname:'JOSE'}],piernas:[{fecha:'2027-01-01T12:00',vuelo:'AR123',origen:'EZE',destino:'MAD',compania:'AR',escalas:['LIM'],transitos:[{iata:'LIM',minutos:90,sinHora:false}]}]}]};
let pCb,rCb;
export const initDB=()=>{},setTenantContext=()=>{},getUserAgency=async()=> 'test',getAgency=async id=>{if(id!=='test')throw new Error('permission-denied');return {status:'active',name:'TEST',branding:{appName:'TEST'},alerts:{}}};
export const listenPassengers=cb=>{pCb=cb;setTimeout(()=>cb(window.fixture.passengers),0)},listenReservations=cb=>{rCb=cb;setTimeout(()=>cb(window.fixture.reservations),0)};
export const addPassenger=async d=>{window.fixture.savedPassenger=d;window.fixture.passengers.push({id:'new',...d});pCb(window.fixture.passengers);return {id:'new'}},updatePassenger=async(id,d)=>{window.fixture.savedPassenger=d;Object.assign(window.fixture.passengers.find(p=>p.id===id),d);pCb(window.fixture.passengers)};
export const addPassengersBatch=async ds=>{window.fixture.imported=ds;if(window.fixture.failAfter!=null){const saved=ds.slice(0,window.fixture.failAfter).map((d,i)=>({id:'partial'+i,...d}));window.fixture.passengers.push(...saved);pCb(window.fixture.passengers);const err=new Error('Firestore unavailable');err.savedIds=saved.map(p=>p.id);delete window.fixture.failAfter;throw err;}return ds.map((_,i)=>'i'+i)};
export const addReservation=async d=>{window.fixture.savedReservation=d;window.fixture.reservations.push({id:'newres',...d});rCb(window.fixture.reservations);return {id:'newres'}},updateReservation=async(id,d)=>{window.fixture.savedReservation=d;Object.assign(window.fixture.reservations.find(r=>r.id===id),d);rCb(window.fixture.reservations)};
export const isNotified=async key=>(await (await fetch('/__notifications/'+encodeURIComponent(key))).json()).read,markNotified=async key=>{const r=await fetch('/__notifications/'+encodeURIComponent(key),{method:'POST'});if(!r.ok)throw new Error('No se pudo guardar');};
export const deletePassenger=async()=>{},markReservationLegsNotified=async()=>{},deleteReservation=async()=>{},deleteReservations=async()=>{},getGdsCities=async()=>[],saveGdsCities=async()=>{};`;
await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.pathname.startsWith('/__notifications/')) {
  const key=decodeURIComponent(u.pathname.slice('/__notifications/'.length));
  if(route.request().method()==='POST'){if(failRead)return route.fulfill({status:503,body:'unavailable'});notifications.add(key);}
  return route.fulfill({contentType:'application/json',body:JSON.stringify({read:notifications.has(key)})});
 }
 const cors={'Access-Control-Allow-Origin':url,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST, GET, PATCH, OPTIONS'};
 if(u.pathname.startsWith('/.netlify/')&&route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
 if(u.hostname==='www.gstatic.com'){
  const body=u.pathname.endsWith('firebase-app.js')?'export const initializeApp=()=>({});':`const user={uid:new URLSearchParams(location.search).get('uid')||'test',email:'test@example.invalid',getIdToken:async()=> 'dummy',getIdTokenResult:async()=>({claims:{iat:Math.floor(Date.now()/1000),auth_time:Math.floor(Date.now()/1000),role:'owner',platformAdmin:true,firebase:{sign_in_second_factor:'totp'}}})};export const getAuth=()=>({currentUser:user}),onAuthStateChanged=(_,cb)=>setTimeout(()=>cb(user),20),signOut=async()=>{},multiFactor=()=>({enrolledFactors:[{}]});`;
  return route.fulfill({contentType:'application/javascript',body});
 }
 if(u.href==='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js') return route.fulfill({contentType:'application/javascript',body:await readFile(xlsxPath,'utf8')});
 if(u.origin!==url&&!u.pathname.startsWith('/.netlify/')) return route.abort();
 if(/\/(sentry|analytics)\.js$/.test(u.pathname)) return route.fulfill({contentType:'application/javascript',body:''});
 if(u.pathname.endsWith('/db.js'))return route.fulfill({contentType:'application/javascript',body:stub});
 if(u.pathname.endsWith('/admin-api/agencies')) return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({agencies:[{id:'other',name:'Otra agencia',status:'active',plan:'trial',createdAt:'2026-10-01'}]})});
 if(u.pathname.endsWith('/admin-api/users')&&route.request().method()==='GET') return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({members:[{uid:'other-user',email:'other@example.invalid',displayName:'Otro',role:'owner',active:true,agencyId:'other',agencyName:'Otra agencia',createdAt:'2026-10-02'}]})});
 if(u.pathname.endsWith('/admin-api/agencies/other/members')) return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({members:[{uid:'other-user',email:'other@example.invalid',role:'owner',active:true,agencyId:'other',agencyName:'Otra agencia',createdAt:'2026-10-02'}]})});
 if(u.pathname.endsWith('/mfa-admin')&&route.request().method()==='GET') return route.fulfill({headers:cors,contentType:'application/json',body:'{"members":[]}'});
 if(u.pathname.endsWith('/mfa-admin')) {await page.evaluate(body=>{window.fixture.mfaReset=body},route.request().postDataJSON());return route.fulfill({headers:cors,contentType:'application/json',body:'{"ok":true}'});}
 if(u.pathname.endsWith('/gemini-scan')) return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({text:JSON.stringify({documentos:await page.evaluate(()=>window.fixture.scanDocuments)})})});
 if(u.pathname.endsWith('/pnr-checkin')) {
  await page.evaluate(body=>{window.fixture.pdfRequest=body;},route.request().postDataJSON());
  return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({data:{pnrAmadeus:'TEST01',pasajeros:[],piernas:[{fecha:'2027-01-01T12:00',vuelo:'AR123',origen:'EZE',destino:'MAD',compania:'AR'}]}})});
 }
 if(u.pathname.startsWith('/.netlify/')) return route.fulfill({headers:cors,contentType:'application/json',body:'{"ok":true}'});
 return route.continue();
});
async function scanFixture(name) {
 const response=page.waitForResponse(r=>r.url().endsWith('/gemini-scan'));
 await page.locator('#scan-file').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
 await response;
 await page.waitForFunction(()=>document.getElementById('scan-status').textContent.includes('procesado'));
}
try{
 await page.addInitScript(()=>sessionStorage.setItem('agencyId','previous-agency'));
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#app-root').style.display==='flex',null,{timeout:5000});
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('agencyId')),'test','El perfil vigente reemplaza la agencia guardada');
 await page.waitForFunction(()=>!document.getElementById('platform-updates-link').hidden,null,{timeout:1500});
 const initialNewsCount=await page.locator('.platform-update').count();
 assert.equal(await page.locator('#platform-updates').evaluate(el=>el.open),false,'Tarjetas plegadas al entrar');
 assert.equal(await page.locator('.platform-update').first().isVisible(),false);
 assert.equal(await page.locator('#platform-updates-link').evaluate(el=>getComputedStyle(el).animationName),'pulse');
 assert.equal(await page.locator('#platform-updates-link').innerText(),'ULTIMAS NOVEDADES');
 assert.equal(await page.locator('#platform-updates-link').evaluate(el=>getComputedStyle(el).color),await page.locator('.stat-card.danger').evaluate(el=>getComputedStyle(el).borderLeftColor),'El aviso comparte el rojo de criticos');
 assert.ok(await page.locator('#platform-updates-link').evaluate(el=>{const s=getComputedStyle(el);return parseFloat(s.fontSize)>=19&&Number(s.fontWeight)>=700;}),'Texto grande y en negrita para destacar el rojo');
 assert.ok(previousReads.every(key=>notifications.has(key)),'El reinicio conserva las lecturas anteriores');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('#platform-updates-link').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true,'El aviso cabe en mobile');
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.ok(parseFloat(await page.locator('#platform-updates-link').evaluate(el=>getComputedStyle(el).animationDuration))<0.01,'Respeta movimiento reducido');
 await page.locator('#platform-updates-link').click();
 await page.waitForFunction(()=>document.getElementById('platform-updates-link').hidden);
 assert.equal(await page.locator('#platform-updates').evaluate(el=>el.open),true,'El aviso abre las tarjetas');
 assert.equal(await page.locator('.platform-update').first().isVisible(),true);
 assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('#platform-updates > summary')),true,'Foco en las novedades');
 assert.equal(notifications.size,legacyReadCount+initialNewsCount,'Una lectura por agente y tarjeta');
 await page.setViewportSize({width:1280,height:720});
 await page.locator('.nav-item[data-view="passengers"]').click();
 await page.locator('.nav-item[data-view="dashboard"]').click();
 assert.equal(await page.locator('#platform-updates').evaluate(el=>el.open),false,'Volver al Dashboard deja las novedades plegadas');
 await page.locator('#platform-updates > summary').click();
 assert.match(await page.locator('.platform-update h3').first().innerText(),/Busca pasajeros sin vincular en Check ins/,'La tarjeta mas reciente explica la busqueda en check-ins');
 const visibleNews=()=>page.locator('.platform-updates-grid').evaluate(track=>{
  const box=track.getBoundingClientRect();
  return [...track.children].filter(card=>{const r=card.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;}).map(card=>card.dataset.updateId);
 });
 assert.equal((await visibleNews()).length,3,'Tres tarjetas completas en escritorio');
 await page.waitForFunction(()=>!document.getElementById('platform-updates-next').disabled);
 assert.equal(await page.locator('#platform-updates-previous').isDisabled(),true);
 assert.equal(await page.locator('#platform-updates-next').isDisabled(),false);
 for (const width of [1280,390]) {
  await page.setViewportSize({width,height:844});
  await page.emulateMedia({reducedMotion:width===1280?'no-preference':'reduce'});
  for (let index=0;index<initialNewsCount;index++) {
   const expanded=page.locator('.platform-update').nth(index).locator('details');
   await expanded.locator('summary').click();
   await page.waitForFunction(index=>{
    const details=document.querySelectorAll('.platform-update details')[index];
    const last=details.lastElementChild.getBoundingClientRect();
    return last.bottom<=innerHeight-8&&details.querySelector('summary').getBoundingClientRect().top>=document.querySelector('.topbar').getBoundingClientRect().bottom+4;
   },index,{timeout:1500});
   assert.equal(await page.locator('.platform-update details[open]').count(),1,'Abrir una tarjeta no abre las otras');
   await expanded.locator('summary').click();
  }
 }
 await page.setViewportSize({width:1280,height:720});
 await page.locator('#platform-updates > summary').click();
 await page.locator('#platform-updates > summary').click();
 await page.waitForFunction(()=>document.getElementById('platform-updates-previous').disabled&&!document.getElementById('platform-updates-next').disabled);
 for (let i=0;i<initialNewsCount-3;i++) {
  await page.locator('#platform-updates-next').click();
  await page.waitForFunction(i=>{
   const t=document.getElementById('platform-updates-track');
   const step=t.firstElementChild.getBoundingClientRect().width+parseFloat(getComputedStyle(t).columnGap);
   return Math.abs(t.scrollLeft-Math.min((i+1)*step,t.scrollWidth-t.clientWidth))<2;
  },i);
 }
 await page.waitForFunction(()=>document.getElementById('platform-updates-next').disabled);
 const oldestId=await page.locator('.platform-update').last().getAttribute('data-update-id');
 assert.ok((await visibleNews()).includes(oldestId),'La flecha derecha muestra la tarjeta mas vieja');
 assert.equal((await visibleNews()).length,3,'El carrusel mantiene tres columnas al avanzar');
 await page.locator('#platform-updates-previous').focus();
 for (let i=initialNewsCount-4;i>=0;i--) {
  await page.keyboard.press('Enter');
  await page.waitForFunction(i=>{
   const t=document.getElementById('platform-updates-track');
   const step=t.firstElementChild.getBoundingClientRect().width+parseFloat(getComputedStyle(t).columnGap);
   return Math.abs(t.scrollLeft-i*step)<2;
  },i);
 }
 await page.waitForFunction(()=>document.getElementById('platform-updates-previous').disabled);
 await page.setViewportSize({width:390,height:844});
 assert.equal((await visibleNews()).length,1,'Una tarjeta legible en celular');
 await page.locator('#platform-updates-next').click();
 await page.waitForFunction(()=>document.querySelector('.platform-updates-grid').scrollLeft>0);
 await page.setViewportSize({width:1280,height:720});

 await page.reload();await page.waitForFunction(()=>document.querySelector('#app-root').style.display==='flex');
 assert.equal(await page.locator('#platform-updates-link').isVisible(),false,'Leer persiste despues de volver a entrar');
 assert.equal(await page.locator('#platform-updates').evaluate(el=>el.open),false,'Vuelve plegado despues de leer');
 await page.goto(url+'/?uid=otro');
 await page.waitForFunction(()=>document.querySelector('#app-root').style.display==='flex'&&!document.getElementById('platform-updates-link').hidden);
 assert.equal(await page.locator('#platform-updates-link').isVisible(),true,'Cada agente tiene su lectura');
 failRead=true;
 await page.locator('#platform-updates-link').click();
 await page.waitForFunction(()=>document.querySelector('.toast-body.error'));
 assert.equal(await page.locator('#platform-updates-link').isVisible(),true,'No se oculta si falla el guardado');
 failRead=false;
 await page.locator('#platform-updates > summary').click();
 await page.locator('#platform-updates > summary').click();
 await page.waitForFunction(()=>document.getElementById('platform-updates-link').hidden);
 assert.equal(notifications.size,legacyReadCount+initialNewsCount*2,'Abrir la flecha tambien marca como leido');
 await page.route(url+'/',async route=>{
  const html=(await readFile(publicDir+'/index.html','utf8')).replace(/(<div class="platform-updates-grid"[^>]*>)/,'$1<article class="platform-update" data-update-id="prueba-nueva"><h3>Nueva novedad de prueba</h3><p>Solo prueba local.</p></article>');
  await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto(url);
 await page.waitForFunction(()=>document.querySelector('#app-root').style.display==='flex'&&!document.getElementById('platform-updates-link').hidden);
 assert.equal(await page.locator('#platform-updates-link').isVisible(),true,'Una nueva tarjeta vuelve a mostrar el aviso');
 await page.locator('#platform-updates-link').click();
 await page.waitForFunction(()=>document.getElementById('platform-updates-link').hidden);
 assert.equal(notifications.size,legacyReadCount+initialNewsCount*2+1,'Solo se marca la tarjeta nueva');
 await page.unroute(url+'/');
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#app-root').style.display==='flex');

 await page.locator('#global-search').fill('jose ber');
 assert.match(await page.locator('#passengers-tbody').innerText(),/BERALDI/);
 await page.locator('#global-search').fill('ber jose');assert.match(await page.locator('#passengers-count').innerText(),/1 pasajero/);
 await page.evaluate(()=>{window.fixture.passengers[0].asistencias=[{num:'V-ANA',compania:'TEST'}];window.openEdit('jose');});
 assert.equal(await page.locator('.asistencia-num').inputValue(),'V-ANA');
 await page.evaluate(()=>{window.closeModal('modal-passenger');window.openNewPassenger();});
 assert.equal(await page.locator('#asistencia-list .asistencia-row').count(),0,'Nuevo pasajero no hereda asistencia');
 await page.evaluate(()=>{
  window.fixture.passengers[0].visas=[{country:'USA',num:'V123',type:'T',exp:'2030-12-20',passport:'AA123'}];
  window.fixture.scanDocuments=[{tipo:'VISA',apellido:'BERALDI',nombre:'JOSE',numero:'V123',pais_destino_visa:'USA'}];
  window.openEdit('jose');
 });
 await scanFixture('visa.pdf');
 assert.equal(await page.locator('.visa-exp').inputValue(),'2030-12-20','OCR parcial conserva vencimiento');
 assert.equal(await page.locator('.visa-passport').inputValue(),'AA123','OCR parcial conserva pasaporte');
 await page.evaluate(()=>{window.fixture.scanDocuments[0].fecha_vencimiento='2035-12-20';});
 let confirmationCount=0;
 page.once('dialog',async dialog=>{confirmationCount++;await dialog.dismiss();});
 await scanFixture('visa-cancel.pdf');
 assert.equal(confirmationCount,1);assert.equal(await page.locator('.visa-exp').inputValue(),'2030-12-20');
 page.once('dialog',async dialog=>{confirmationCount++;await dialog.accept();});
 await scanFixture('visa-accept.pdf');
 assert.equal(confirmationCount,2);assert.equal(await page.locator('.visa-exp').inputValue(),'2035-12-20');
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
 assert.deepEqual(saved.piernas[0].transitos,[{iata:'LIM',minutos:90,sinHora:false}],'Editar conserva el transito');
 assert.deepEqual(saved.pasajeros,['jose']);assert.deepEqual(saved.pendingPassengers,[]);
 await page.evaluate(()=>window.openNewReservation());
 const pdfZone=page.locator('#res-pnr-raw').locator('..').locator('..');
 const pdfHint=page.getByText('Solta el PDF aca',{exact:true});
 const pdfDrag=await page.evaluateHandle(()=>{
  const data=new DataTransfer();
  data.items.add(new File(['%PDF-1.4\nuno'],'uno.pdf',{type:'application/pdf'}));
  data.items.add(new File(['%PDF-1.4\ndos'],'dos.pdf',{type:'application/pdf'}));
  return data;
 });
 await page.locator('#res-pnr-raw').fill('PNR de prueba');
 await page.locator('#res-pnr-raw').dispatchEvent('dragover',{dataTransfer:pdfDrag});
 assert.equal(await pdfHint.isVisible(),true,'Muestra donde soltar el PDF sobre el campo PNR');
 await pdfZone.dispatchEvent('dragleave',{dataTransfer:pdfDrag,relatedTarget:await page.locator('#btn-attach-pdf').elementHandle()});
 assert.equal(await pdfHint.isVisible(),true,'El recuadro permanece al pasar entre sus controles');
 await pdfZone.dispatchEvent('dragleave',{dataTransfer:pdfDrag});
 assert.equal(await pdfHint.isVisible(),false,'Oculta el recuadro al salir de la zona');
 const textDrag=await page.evaluateHandle(()=>{const data=new DataTransfer();data.setData('text/plain','PNR');return data;});
 await pdfZone.dispatchEvent('dragover',{dataTransfer:textDrag});
 assert.equal(await pdfHint.isVisible(),false,'Arrastrar texto no activa la carga de archivos');
 await page.evaluate(()=>{document.getElementById('btn-attach-pdf').disabled=true;});
 await pdfZone.dispatchEvent('dragover',{dataTransfer:pdfDrag});
 assert.equal(await pdfHint.isVisible(),false,'No ofrece cargar archivos mientras el boton esta deshabilitado');
 await pdfZone.dispatchEvent('drop',{dataTransfer:pdfDrag});
 assert.equal(await page.evaluate(()=>window.fixture.pdfRequest),undefined,'El arrastre respeta el bloqueo de la carga');
 await page.evaluate(()=>{document.getElementById('btn-attach-pdf').disabled=false;});
 await pdfZone.dispatchEvent('dragover',{dataTransfer:pdfDrag});
 const pdfResponse=page.waitForResponse(r=>r.url().endsWith('/pnr-checkin')&&r.request().method()==='POST');
 await page.locator('#res-pnr-raw').dispatchEvent('drop',{dataTransfer:pdfDrag});
 await pdfResponse;
 await page.waitForFunction(()=>document.getElementById('res-pnr-status').textContent.includes('2 e-tickets interpretados'));
 assert.equal(await pdfHint.isVisible(),false,'Oculta el recuadro despues de soltar');
 assert.deepEqual(await page.evaluate(()=>window.fixture.pdfRequest.pdfs),[Buffer.from('%PDF-1.4\nuno').toString('base64'),Buffer.from('%PDF-1.4\ndos').toString('base64')]);
 assert.equal(await page.locator('#res-pnr').inputValue(),'TEST01','La carga por arrastre completa la reserva');
 assert.equal(await page.locator('#res-pnr-raw').inputValue(),'PNR de prueba','Soltar un archivo no reemplaza el PNR pegado');
 await page.evaluate(()=>window.closeModal('modal-reservation'));
 await page.evaluate(()=>{
  window.showView('import');
  window.fixture.scanDocuments=[{tipo:'VISA',apellido:'PRUEBA',nombre:'VISA',numero:'V123',pais_destino_visa:'USA',fecha_vencimiento:'2030-12-20'}];
 });
 await page.evaluate(()=>window.handleImportFiles({target:{files:[new File(['%PDF-1.4\nfixture'],'only-visa.pdf',{type:'application/pdf'})],value:''}}));
 await page.locator('#import-review-wrap').waitFor({state:'visible'});
 await page.locator('#btn-import-save').click();
 assert.equal(await page.evaluate(()=>window.fixture.imported[0].visa1.num),'V123','Primer documento visa se guarda');
 for(const tipo of ['ESTA','ASISTENCIA']) {
  await page.evaluate(tipo=>{
   window.showView('import');
   window.fixture.scanDocuments=[{tipo,apellido:'PRUEBA',nombre:tipo,numero:'DOC001',fecha_vencimiento:'2030-12-20'}];
   return window.handleImportFiles({target:{files:[new File(['%PDF-1.4\nfixture'],'documento.pdf',{type:'application/pdf'})],value:''}});
  },tipo);
  await page.locator('#import-review-wrap').waitFor({state:'visible'});await page.locator('#btn-import-save').click();
  assert.equal(await page.evaluate(tipo=>tipo==='ASISTENCIA'?window.fixture.imported[0].asistencias[0].num:window.fixture.imported[0].visa1.num,tipo),'DOC001');
 }
 await page.evaluate(()=>window.showView('import'));
 await page.locator('#import-excel-input').setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from('APELLIDO,NOMBRE,FECHA NAC,FFN AEROLINEA,FFN NUMERO,OBSERVACIONES,EMERGENCIA TELEFONO,ASISTENCIA COMPANIA,ASISTENCIA NUMERO\nPRUEBA,CSV,01/01/1980,AA,000123,Observacion ficticia,+5490000000000,TEST,V001')});
 await page.locator('#import-review-wrap').waitFor({state:'visible'});
 await page.locator('#btn-import-save').click();
 const imported=await page.evaluate(()=>window.fixture.imported[0]);
 assert.equal(imported.ffn[0].number,'000123');assert.equal(imported.notes,'Observacion ficticia');assert.equal(imported.emergencyContact.phone,'+5490000000000');assert.equal(imported.asistencias[0].num,'V001');
 await page.evaluate(()=>window.showView('import'));
 await page.locator('#import-excel-input').setInputFiles({name:'duplicates.csv',mimeType:'text/csv',buffer:Buffer.from('APELLIDO,NOMBRE,FECHA NAC,DNI\nPEREZ,ANA,01/01/1980,30123456\nPEREZ,ANA,01/01/1980,30123456\nPEREZ,ANA,01/01/1990,40123456\nBERALDI,JOSE,01/01/1980,')});
 await page.locator('#import-review-wrap').waitFor({state:'visible'});await page.locator('#btn-import-save').click();
 const deduplicated=await page.evaluate(()=>window.fixture.imported);
 assert.equal(deduplicated.length,2,'Omite duplicado del archivo y pasajero existente sin descartar homonimos');
 assert.deepEqual(deduplicated.map(p=>p.dni.num),['30123456','40123456']);
 await page.evaluate(()=>{window.showView('import');window.fixture.failAfter=450;});
 const rows=Array.from({length:451},(_,i)=>`TEST${i},IMPORT,01/01/1980,${30000000+i}`).join('\n');
 await page.locator('#import-excel-input').setInputFiles({name:'partial.csv',mimeType:'text/csv',buffer:Buffer.from('APELLIDO,NOMBRE,FECHA NAC,DNI\n'+rows)});
 await page.locator('#import-review-wrap').waitFor({state:'visible'});await page.locator('#btn-import-save').click();
 assert.match(await page.locator('#toast-text').innerText(),/450 importado/);
 assert.match(await page.locator('#import-review-sub').innerText(),/1 pasajero/);
 assert.equal(await page.evaluate(()=>window.fixture.passengers.filter(p=>p.id.startsWith('partial')).length),450);
 assert.equal(await page.locator('#btn-import-save').isEnabled(),true);
 await page.locator('#btn-import-save').click();
 assert.equal(await page.evaluate(()=>window.fixture.imported.length),1);
 assert.equal(await page.evaluate(()=>window.fixture.imported[0].lastname),'TEST450');
 await page.locator('#nav-admin').click();
 await page.locator('[data-agency-edit="other"]').waitFor();
 await page.locator('[data-admin-tab="users"]').click();
 await page.locator('#admin-us-filter-agency').selectOption('other');
 await page.locator('[data-user-mfa-reset="other-user"]').click({timeout:5000});
 await page.locator('#confirm-ok-btn').click();
 await page.waitForFunction(()=>window.fixture.mfaReset?.targetUid==='other-user');
 assert.deepEqual(await page.evaluate(()=>window.fixture.mfaReset),{action:'force-reset',targetUid:'other-user'});
 for(const view of ['dashboard','documents','alerts','travel','security','cities','dashboard','cities']) {
  await page.evaluate(view=>window.showView(view),view);
  await page.locator('#view-'+view+'.active').waitFor();
  if(view==='cities') await page.waitForFunction(()=>!document.getElementById('gds-cities-list').textContent.includes('Cargando'));
 }
 await page.locator('#btn-gds-city-add').click();
 assert.equal(await page.locator('[data-city-id]').count(),1,'Volver a la vista no duplica listeners');
 await page.evaluate(()=>{window.showView('travel');window.setTravelMode('gds');});
 await page.locator('#tv-gds-text').fill('2  MU 746 R 28APR 2*EZEPVG HK1');
 await page.waitForFunction(()=>document.getElementById('gds-preview').textContent.includes('MU746'));
 assert.deepEqual(errors,[]);
 console.log('PASS browser: platform news (per-agent read persistence, new card, save retry, mobile, reduced motion), search, optional emergency roundtrip, pending linkage, PDF drop feedback and multi-file upload, real CSV parser to save, platform MFA reset across agencies; no external services');
}catch(e){console.error('Browser errors',errors);console.error('Toast',await page.locator('#toast-text').innerText());throw e;}finally{await browser.close();server.close();}
