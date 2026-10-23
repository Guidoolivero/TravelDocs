import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as alerts from '../public/js/alert-core.mjs';
import * as forms from '../public/js/form-reminders.mjs';
import * as requirements from '../lib/requisitos-checkin.mjs';

// Solo Firestore, EmailJS y el reloj se simulan; se ejecuta el handler real.
function fixture({ failSend = false, completed = false } = {}) {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const documents = new Map([
    ['agencies/test', { status: 'active', alerts: { email: 'test@example.invalid', emailjsPublicKey: 'test', emailjsServiceId: 'test', emailjsTemplateId: 'test' } }],
    ['agencies/test/reservations/r', { fecha: '2026-12-10T12:00', hasFormReminders: true, pendingPassengers: [{lastname:'PRUEBA',firstname:'ANA'}], formReminders: [{id:'f',title:'Ingreso',date:'2026-12-10',daysBefore:60,completed}] }],
  ]);
  const sent = [];
  function ref(path, filters = []) {
    return {
      path, collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id}`),
      where: (field, op, value) => ref(path, [...filters, [field,op,value]]),
      async get() {
        const docs = [...documents].filter(([key, data]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/') && filters.every(([field,op,value]) => {
          const actual = field === '__name__' ? key.split('/').at(-1) : data[field];
          return op === 'in' ? value.includes(actual) : op === '==' ? actual === value : actual <= value;
        })).map(([key,data]) => ({id:key.split('/').at(-1),ref:ref(key),data:()=>data}));
        return { docs, size: docs.length, forEach: fn => docs.forEach(fn) };
      },
    };
  }
  const db = { collection: name => ref(name), batch() {
    const writes = [];
    return { set: (r,value) => writes.push([r.path,value]), update: (r,value) => writes.push([r.path,value]), async commit() { for (const [key,value] of writes) documents.set(key,{...documents.get(key),...value}); } };
  } };
  const module = {exports:{}};
  const dependencies = {
    'firebase-admin': { apps:[{}], firestore:()=>db },
    'firebase-admin/firestore': { FieldValue:{serverTimestamp:()=>now}, FieldPath:{documentId:()=>'__name__'} },
    '../../public/js/alert-core.mjs': alerts,
    '../../public/js/form-reminders.mjs': forms,
    '../../lib/requisitos-checkin.mjs': requirements,
    './_sentry.cjs': {wrapHandler:fn=>fn},
  };
  class Clock extends Date { static now() { return now; } }
  runInNewContext(readFileSync(new URL('../netlify/functions/send-alerts.cjs',import.meta.url),'utf8'), {
    module,exports:module.exports,require:id=>{assert.ok(dependencies[id],id);return dependencies[id];},Date:Clock,Intl,AbortSignal,
    process:{env:{}},console:{log(){},warn(){},error(){}},setTimeout:fn=>fn(),
    fetch:async(url,opts)=>{assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send');sent.push(JSON.parse(opts.body));return {ok:!failSend,status:503,text:async()=> 'test failure'};},
  });
  return {run:()=>module.exports.handler({}),sent,documents};
}

test('cron avisa formularios fuera del cutoff de viajes y no reenvia despues de marcar', async () => {
  const f=fixture();
  assert.equal(JSON.parse((await f.run()).body).emailsSent,1);
  assert.match(f.sent[0].template_params.message,/PRUEBA, ANA/);
  assert.equal(JSON.parse((await f.run()).body).emailsSent,0);
  assert.equal(f.sent.length,1);
});
test('cron no marca como enviado si EmailJS falla y omite completados',async()=>{
  const f=fixture({failSend:true});
  assert.equal(JSON.parse((await f.run()).body).ok,false);
  assert.equal([...f.documents.keys()].some(key=>key.includes('/notifications/')),false);
  const complete=fixture({completed:true});
  assert.equal(JSON.parse((await complete.run()).body).emailsSent,0);
  assert.equal(complete.sent.length,0);
});
