import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialDates } from '../netlify/functions/lib/billing.cjs';

test('30 dias gratuitos desde alta ART, fin el 20 factura el mes siguiente', () => {
  assert.deepEqual(trialDates('2026-10-21'), { trialEndsOn: '2026-11-20', firstPeriod: '2026-12' });
});

test('fecha desconocida o invalida no habilita facturacion', () => {
  for (const value of ['', undefined, '2026-02-30', 'incorrecta']) assert.equal(trialDates(value), null);
});

test('limites de mes, febrero bisiesto y cambio de ano', () => {
  assert.deepEqual(trialDates('2026-10-02'), { trialEndsOn: '2026-11-01', firstPeriod: '2026-11' });
  assert.deepEqual(trialDates('2028-01-31'), { trialEndsOn: '2028-03-01', firstPeriod: '2028-03' });
  assert.deepEqual(trialDates('2026-12-20'), { trialEndsOn: '2027-01-19', firstPeriod: '2027-02' });
});

test('elegibilidad: activas en prueba no se cobran y ficha incompleta bloquea', async () => {
  const { billingStatus } = await import('../netlify/functions/lib/billing.cjs');
  const profile = { taxId: '20123456786', legalName: 'Agencia de prueba', address: 'Calle 1', condition: 'responsable_inscripto', currency: 'ARS', amount: 6000000 };
  for (let i = 0; i < 5; i++) {
    const status = billingStatus({ status: 'active', createdOn: '2026-10-21' }, profile, '2026-11-01');
    assert.equal(status.state, 'trial');
    assert.equal(status.firstPeriod, '2026-12');
  }
  assert.equal(billingStatus({ status: 'active', createdOn: '2026-10-21' }, profile, '2026-12-01').state, 'ready');
  assert.equal(billingStatus({ status: 'active', createdOn: '2026-10-21' }, {}, '2026-12-01').state, 'incomplete');
  assert.equal(billingStatus({ status: 'suspended', createdOn: '2026-10-21' }, profile, '2026-12-01').state, 'suspended');
  assert.equal(billingStatus(null, profile, '2026-12-01').state, 'deleted');
  assert.equal(billingStatus({ status: 'active' }, profile, '2026-12-01').state, 'missing_date');
});

test('ficha opcional valida importes exactos y rechaza datos invalidos o campos extra', async () => {
  const { validateBillingProfile, parsePrice } = await import('../netlify/functions/lib/billing.cjs');
  assert.deepEqual(validateBillingProfile({}), {});
  assert.deepEqual(validateBillingProfile({ legalName: '  Prueba  ', currency: '' }), { legalName: 'Prueba', currency: '' });
  assert.equal(parsePrice('60000'), 6000000);
  assert.equal(parsePrice('100.01'), 10001);
  assert.equal(parsePrice('100,01'), 10001);
  for (const price of ['1.005', '-1', '1e4', '1.000,00']) assert.throws(() => parsePrice(price));
  for (const profile of [{ amount: -100 }, { amount: 1.5 }, { taxId: '123' }, { taxId: '20123456789' }, { condition: 'otro' }, { currency: 'BTC' }, { enabled: true }]) {
    assert.throws(() => validateBillingProfile(profile));
  }
  assert.equal(validateBillingProfile({ taxId: '20-12345678-6' }).taxId, '20123456786');
});

test('precio nuevo rige al mes siguiente sin cambiar el pendiente actual', async () => {
  const { billingRecord, billingProfileForPeriod } = await import('../netlify/functions/lib/billing.cjs');
  const profile = { taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'monotributo', currency: 'USD', amount: 10000 };
  const first = billingRecord(profile, null, '2026-09-20');
  const changed = billingRecord({ ...profile, amount: 12000 }, first, '2026-11-15');
  assert.equal(billingProfileForPeriod(changed, '2026-11').amount, 10000);
  assert.equal(billingProfileForPeriod(changed, '2026-12').amount, 12000);
  const again = billingRecord({ ...profile, amount: 15000 }, changed, '2026-11-20');
  assert.equal(billingProfileForPeriod(again, '2026-11').amount, 10000);
  assert.equal(billingProfileForPeriod(again, '2026-12').amount, 15000);
});

test('completar ficha parcial conserva el precio cargado y permite emitir el mes siguiente', async () => {
  const { billingRecord, billingInvoice } = await import('../netlify/functions/lib/billing.cjs');
  const partial = { taxId: '20123456786', legalName: 'Prueba', condition: 'monotributo', currency: 'ARS', amount: 6000000 };
  const before = billingRecord(partial, null, '2026-10-15');
  const record = billingRecord({ ...partial, address: 'Calle 1' }, before, '2026-10-20');
  const invoice = billingInvoice({ agency: { status: 'active', createdOn: '2026-01-01' }, record, period: '2026-11', today: '2026-11-02', salesPoint: 1 });
  assert.equal(record.enabledOn, '2026-10-20');
  assert.equal(invoice.items[0].amount, 6000000);
  assert.equal(invoice.currency, 'ARS');
});

test('recompletar ficha corrige precio futuro sin modificar el precio del mes actual', async () => {
  const { billingRecord, billingProfileForPeriod } = await import('../netlify/functions/lib/billing.cjs');
  const profile = { taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'monotributo', currency: 'ARS', amount: 6000000 };
  const original = billingRecord(profile, null, '2026-09-20');
  const increased = billingRecord({ ...profile, amount: 8000000 }, original, '2026-11-05');
  const partial = billingRecord({ ...profile, address: '' }, increased, '2026-11-06');
  const restored = billingRecord(profile, partial, '2026-11-07');
  assert.equal(billingProfileForPeriod(restored, '2026-11').amount, 6000000);
  assert.equal(billingProfileForPeriod(restored, '2026-12').amount, 6000000);
  assert.equal(restored.enabledOn, '2026-11-07');
});

test('solicitud C usa precio del mes, servicio de un dia y bloquea retroactivos', async () => {
  const { billingRecord, billingInvoice } = await import('../netlify/functions/lib/billing.cjs');
  const profile = { taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'responsable_inscripto', currency: 'ARS', amount: 6000000 };
  const record = billingRecord(profile, null, '2026-09-20');
  const agency = { status: 'active', createdOn: '2026-01-01' };
  const invoice = billingInvoice({ agency, record, period: '2026-11', today: '2026-11-02', salesPoint: 1 });
  assert.equal(invoice.issuer, 'monotributo');
  assert.equal(invoice.concept, 'services');
  assert.equal(invoice.items[0].amount, 6000000);
  assert.equal(invoice.items[0].unitPrice, '60000.00');
  assert.deepEqual(invoice.service, { from: '2026-11-02', to: '2026-11-02', dueDate: '2026-11-02' });
  assert.throws(() => billingInvoice({ agency, record, period: '2026-10', today: '2026-11-02', salesPoint: 1 }));
  assert.throws(() => billingInvoice({ agency: { ...agency, status: 'suspended' }, record, period: '2026-11', today: '2026-11-02', salesPoint: 1 }));
});

test('USD exige cotizacion ARCA y cancelacion en la misma moneda', async () => {
  const { billingRecord, billingInvoice } = await import('../netlify/functions/lib/billing.cjs');
  const profile = { taxId: '20123456786', legalName: 'Prueba', address: 'Calle 1', condition: 'monotributo', currency: 'USD', amount: 10000 };
  const args = { agency: { status: 'active', createdOn: '2026-01-01' }, record: billingRecord(profile, null, '2026-09-20'), period: '2026-11', today: '2026-11-02', salesPoint: 1 };
  assert.throws(() => billingInvoice(args), /cotizacion/);
  const input = billingInvoice({ ...args, quotation: { currencyId: 'DOL', rate: 1500, date: '20261030' } });
  assert.equal(input.paidInForeignCurrency, true);
  assert.equal(input.exchangeRate, '1500');
  assert.equal(input.items[0].amount, 10000);
  assert.throws(() => billingInvoice({ ...args, quotation: { currencyId: 'DOL', rate: 0, date: '20261030' } }));
});

test('condicion de venta valida una opcion y conserva transferencia por defecto', async () => {
  const { validateBillingProfile, billingProfileForPeriod } = await import('../netlify/functions/lib/billing.cjs');
  assert.equal(billingProfileForPeriod({}, '2026-11').saleCondition, 'Transferencia bancaria');
  assert.equal(validateBillingProfile({ saleCondition: 'Cuenta corriente' }).saleCondition, 'Cuenta corriente');
  assert.throws(() => validateBillingProfile({ saleCondition: 'Inventada' }));
  assert.throws(() => validateBillingProfile({ saleCondition: ['Contado', 'Cheque'] }));
});

test('incorporacion inicial permite el mes confirmado sin falsear fecha de alta ni habilitacion', async () => {
  const { initialBillingRecord, billingInvoice, billingRecord, billingProfileForPeriod } = await import('../netlify/functions/lib/billing.cjs');
  const agency = { createdOn: '2026-08-01', status: 'active' };
  const profile = { taxId: '20123456786', legalName: 'Ficticia', address: 'Calle 1', condition: 'responsable_inscripto', currency: 'ARS', amount: 6000000 };
  const record = initialBillingRecord(profile, agency, '2026-11', '2026-11-02');
  assert.equal(record.enabledOn, '2026-11-02');
  assert.equal(record.initialPeriod, '2026-11');
  const args = { agency, record, period: '2026-11', today: '2026-11-02', salesPoint: 2 };
  assert.equal(billingInvoice(args).items[0].amount, 6000000);
  assert.throws(() => billingInvoice({ ...args, period: '2026-10' }), /actual/);
  const changed = billingRecord({ ...profile, amount: 7000000 }, record, '2026-11-15');
  assert.equal(changed.initialPeriod, '2026-11');
  assert.equal(billingProfileForPeriod(changed, '2026-11').amount, 6000000);
  assert.equal(billingProfileForPeriod(changed, '2026-12').amount, 7000000);
  for (const [data, period, receiver] of [
    [agency, '2026-10', profile], [agency, '2026-12', profile],
    [{ ...agency, createdOn: '2026-10-21' }, '2026-11', profile],
    [{ ...agency, status: 'suspended' }, '2026-11', profile],
    [{ status: 'active' }, '2026-11', profile], [agency, '2026-11', {}],
  ]) assert.throws(() => initialBillingRecord(receiver, data, period, '2026-11-02'));
});
