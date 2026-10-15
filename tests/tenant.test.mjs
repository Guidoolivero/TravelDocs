import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailjsParaAlta } from '../public/js/tenant.js';

test('el alta de agencia trae la cuenta EmailJS compartida y no pisa una propia', () => {
  const vacio = emailjsParaAlta({});
  assert.equal(vacio.emailjsPublicKey, '9hDeLGPwhgAkqc7HZ');
  assert.equal(vacio.emailjsServiceId, 'service_g7h8qrd');
  assert.equal(vacio.emailjsTemplateId, 'template_jwdgrsr');

  const propio = emailjsParaAlta({
    emailjsPublicKey: 'otra',
    emailjsServiceId: 'service_x',
    emailjsTemplateId: 'template_x',
  });
  assert.deepEqual(propio, {
    emailjsPublicKey: 'otra',
    emailjsServiceId: 'service_x',
    emailjsTemplateId: 'template_x',
  });

  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="admin-ag-emailjs-pk" value="9hDeLGPwhgAkqc7HZ"/);
  assert.match(html, /id="admin-ag-emailjs-svc" value="service_g7h8qrd"/);
  assert.match(html, /id="admin-ag-emailjs-tpl" value="template_jwdgrsr"/);
});
