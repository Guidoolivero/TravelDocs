import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from './firebase-fixture.mjs';
import { renderTravelDocsPdf } from '../netlify/functions/lib/invoice-pdf.cjs';
const env = { BILLING_ENABLED: 'true', ARCA_ENVIRONMENT: 'test', BILLING_FIREBASE_PROJECT_ID: 'demo-billing', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"demo-billing"}', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8185' };
for (const environment of ['test', 'production']) for (const currency of ['ARS', 'USD']) {
  test(`PDF ${currency} ${environment} se reproduce desde snapshot autorizado sin emitir`, async () => {
    let printedIssuer, printedSaleCondition, printedNotice;
    const runtimeEnv = environment === 'test' ? env : { ...env, ARCA_ENVIRONMENT: 'production', CONTEXT: 'production', FIRESTORE_EMULATOR_HOST: '', BILLING_FIREBASE_PROJECT_ID: 'tradingdocs-mt', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"tradingdocs-mt"}', ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '2', BILLING_PRODUCTION_CONFIRMATION: '20123456786:2' };
    const f = fixture({ env: runtimeEnv, modules: { './lib/invoice-pdf.cjs': { renderTravelDocsPdf(doc, options) {
      printedIssuer = doc.issuer;
      printedSaleCondition = doc.saleConditions;
      printedNotice = options.notice;
      return renderTravelDocsPdf(doc, options);
    } } } });
    const id = 'a'.repeat(64);
    const invoice = {
      status: 'authorized', environment,
      issuer: { legalName: 'Emisor ficticio', address: 'Calle Prueba 100', taxId: '20123456786', condition: 'monotributo', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' },
      receiver: { legalName: 'Agencia ficticia', address: 'Calle Prueba 200', ...(currency === 'USD' ? { saleCondition: 'Cuenta corriente' } : {}) },
      input: { items: [{ description: 'Servicio TravelDocs - 2026-11', quantity: 1, amount: 10000, unitPrice: '100.00' }] },
      outcome: { kind: 'authorized', voucher: {
        voucherType: 11, voucherClass: 'C', salesPoint: 1, number: 1, date: '2026-11-02', cae: '12345678901234', caeExpiry: '2026-11-12',
        qr: 'https://www.arca.gob.ar/fe/qr/?p=PRUEBA',
        header: { concept: 2, documentType: 80, documentNumber: '20123456786', receiverVatConditionId: 6, currencyId: currency === 'USD' ? 'DOL' : 'PES', exchangeRate: currency === 'USD' ? '1500' : '1', serviceStartDate: '2026-11-02', serviceEndDate: '2026-11-02', paymentDueDate: '2026-11-02' },
        amounts: { computedTotal: 10000, sentTotal: 10000, vatAdjustment: 0 },
        totals: { total: 10000, netTaxed: 10000, untaxed: 0, exempt: 0, vat: 0, otherTaxes: 0, vatRates: [], taxes: [] },
      } },
    };
    f.docs.set('billingInvoices/' + id, invoice);
    const response = await f.invoke('billing-pdf', { invoiceId: id });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(printedSaleCondition, currency === 'USD' ? 'Cuenta corriente' : 'Transferencia bancaria');
    assert.equal(printedIssuer.tradeName, 'TravelDocs');
    assert.equal(printedIssuer.legalName, invoice.issuer.legalName);
    assert.equal(printedIssuer.taxId, invoice.issuer.taxId);
    const result = JSON.parse(response.body), pdf = Buffer.from(result.pdf, 'base64');
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length, 1, 'Factura mensual en una hoja A4');
    assert.equal(printedNotice, environment === 'test' ? 'HOMOLOGACION - SIN VALOR FISCAL' : '');
    assert.match(result.filename, environment === 'test' ? /^prueba-factura-C-/ : /^factura-C-/);
    assert.deepEqual(f.docs.get('billingInvoices/' + id), invoice);
    const audit = f.added.find(([collection, data]) => collection === 'auditLogs' && data.action === 'billing-pdf')[1];
    assert.equal(audit.details.invoiceId, id);
    assert.equal(audit.details.environment, environment);
    assert.doesNotMatch(JSON.stringify(audit), /Emisor ficticio|Agencia ficticia|Calle Prueba/);
    f.docs.get('billingInvoices/' + id).environment = environment === 'test' ? 'production' : 'test';
    assert.equal((await f.invoke('billing-pdf', { invoiceId: id })).statusCode, 409);
    if (process.env.BILLING_PDF_QA_DIR) {
      await mkdir(process.env.BILLING_PDF_QA_DIR, { recursive: true });
      await writeFile(`${process.env.BILLING_PDF_QA_DIR}/${environment}-${currency}.pdf`, pdf);
    }
  });
}

for (const environment of ['test', 'production']) for (const currency of ['ARS', 'USD']) {
  test(`vista previa PDF ${currency} ${environment} no inventa numeracion, CAE ni QR`, async () => {
    let printedDoc, printedOptions;
    const { buildDraftDocument } = await import('../netlify/functions/lib/invoice-pdf.cjs');
    const runtimeEnv = environment === 'test' ? env : { ...env, ARCA_ENVIRONMENT: 'production', CONTEXT: 'production', FIRESTORE_EMULATOR_HOST: '', BILLING_FIREBASE_PROJECT_ID: 'tradingdocs-mt', FIREBASE_SERVICE_ACCOUNT: '{"project_id":"tradingdocs-mt"}', ARCA_TAX_ID: '20123456786', ARCA_SALES_POINT: '2', BILLING_PRODUCTION_CONFIRMATION: '20123456786:2' };
    const f = fixture({ env: runtimeEnv, modules: { './lib/invoice-pdf.cjs': { buildDraftDocument,
      renderTravelDocsPdf(doc, options) { printedDoc = doc; printedOptions = options; return renderTravelDocsPdf(doc, options); },
    } } });
    const id = 'c'.repeat(64), digest = 'd'.repeat(64);
    const invoice = { status: 'draft', environment, digest, period: '2026-11',
      issuer: { legalName: 'Emisor ficticio', address: 'Calle Prueba 100', taxId: '20123456786', condition: 'monotributo', grossIncome: 'Exento', activitiesStartDate: '2026-01-01' },
      receiver: { legalName: 'Agencia ficticia', taxId: '20123456786', address: 'Calle Prueba 200', condition: 'responsable_inscripto', saleCondition: 'Transferencia bancaria' },
      input: { date: '2026-11-03', currency, salesPoint: 2, ...(currency === 'USD' ? { exchangeRate: '1545.5' } : {}), service: { from: '2026-11-03', to: '2026-11-03', dueDate: '2026-11-03' },
        items: [{ description: 'Servicio TravelDocs - 2026-11', quantity: 1, amount: 10000, unitPrice: '100.00' }] },
    };
    f.docs.set('billingInvoices/' + id, invoice);
    assert.equal((await f.invoke('billing-pdf', { invoiceId: id })).statusCode, 409);
    const response = await f.invoke('billing-pdf', { invoiceId: id, preview: true, digest });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(printedOptions.draft, true);
    assert.match(printedOptions.notice, /BORRADOR.*SIN VALOR FISCAL/);
    assert.equal(printedDoc.authorization, undefined);
    assert.equal(printedDoc.qr, undefined);
    assert.equal(printedDoc.number, 'Sin emitir');
    assert.equal(printedDoc.totals.total, 10000);
    assert.equal(printedDoc.receiver.name, invoice.receiver.legalName);
    const result = JSON.parse(response.body), pdf = Buffer.from(result.pdf, 'base64');
    assert.equal(result.preview, true);
    assert.match(result.filename, /^borrador-/);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal([...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length, 1);
    assert.deepEqual(f.docs.get('billingInvoices/' + id), invoice);
    assert.equal((await f.invoke('billing-pdf', { invoiceId: id, preview: true, digest: 'e'.repeat(64) })).statusCode, 409);
    assert.equal((await f.invoke('billing-pdf', { invoiceId: id, preview: true, digest }, 'user')).statusCode, 403);
    for (const status of ['issuing', 'indeterminate', 'conflict', 'rejected', 'authorized']) {
      f.docs.get('billingInvoices/' + id).status = status;
      assert.equal((await f.invoke('billing-pdf', { invoiceId: id, preview: true, digest })).statusCode, 409);
    }
    if (process.env.BILLING_PDF_QA_DIR) {
      await mkdir(process.env.BILLING_PDF_QA_DIR, { recursive: true });
      await writeFile(`${process.env.BILLING_PDF_QA_DIR}/draft-${environment}-${currency}.pdf`, pdf);
    }
  });
}

test('importes del PDF conservan centavos sin redondeos intermedios', async () => {
  const { formatInvoiceAmount } = await import('../netlify/functions/lib/invoice-pdf.cjs');
  for (const [input, expected] of [[0, '0,00'], [1, '0,01'], [10000, '100,00'], [6000000, '60.000,00'], [-123456, '-1.234,56'], [999999999999, '9.999.999.999,99']]) {
    assert.equal(formatInvoiceAmount(input), expected);
  }
});
