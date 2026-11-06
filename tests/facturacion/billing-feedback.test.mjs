import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingErrorText, billingOutcomeText } from '../../public/js/facturacion/billing-feedback.mjs';

test('conexion incierta pide consultar y nunca afirma que no se emitio', () => {
  for (const error of [{ code: 'ARCA_TRANSPORT_ERROR' }, { name: 'TimeoutError' }, { name: 'AbortError' }, { code: 'ARCA_INVALID_SOAP_RESPONSE' }]) {
    assert.match(billingErrorText(error), /Consultar ARCA/);
    assert.match(billingErrorText(error), /podria haberse autorizado/);
  }
  assert.match(billingErrorText(new TypeError('Failed to fetch')), /conexion/);
});
test('mensajes de acceso, configuracion y datos no exponen diagnosticos ni claves', () => {
  assert.match(billingErrorText({ code: 'ARCA_AUTHENTICATION_ERROR', message: 'TOKEN=secreto' }), /certificado/);
  assert.match(billingErrorText({ code: 'ARCA_CONFIGURATION_ERROR' }), /configuracion/);
  assert.match(billingErrorText({ code: 'ARCA_INPUT_MISSING_FIELD', field: 'items' }), /detalle del servicio/);
  assert.match(billingErrorText({ code: 'ARCA_LOCK_TIMEOUT' }), /otra operacion/);
  assert.match(billingErrorText({ code: 'ARCA_INPUT_IDEMPOTENCY_MISMATCH' }), /revision/);
  assert.doesNotMatch(billingErrorText(new Error('PRIVATE KEY y TOKEN=secreto')), /PRIVATE KEY|secreto/);
  for (const error of [null, { code: 14 }, { status: 502, error: 'Error desconocido.' }]) assert.match(billingErrorText(error), /Consulta el estado/);
  assert.match(billingErrorText({ status: 401 }), /sesion/);
  assert.match(billingErrorText({ status: 403 }), /permisos/);
});
test('respuestas HTTP 200 con rechazo o incertidumbre tambien se explican', () => {
  assert.match(billingOutcomeText({ status: 'rejected', outcome: { issues: [{ message: 'Por favor ingrese al menos una linea de detalle.' }] } }), /detalle del servicio/);
  assert.match(billingOutcomeText({ status: 'issuing' }), /Consultar ARCA/);
  assert.match(billingOutcomeText({ status: 'indeterminate', outcome: { lookup: { kind: 'not_found' } } }), /misma factura/);
  assert.match(billingOutcomeText({ status: 'conflict' }), /revision/);
  assert.equal(billingOutcomeText({ status: 'authorized' }), '');
});
