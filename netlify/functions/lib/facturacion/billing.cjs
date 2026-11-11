// Reglas de facturacion mensual. Las fechas de calendario se calculan en ART.
function trialDates(createdOn) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdOn || "")) return null;
  const end = new Date(`${createdOn}T12:00:00Z`);
  if (!Number.isFinite(end.getTime()) || end.toISOString().slice(0, 10) !== createdOn) return null;
  end.setUTCDate(end.getUTCDate() + 30);
  const trialEndsOn = end.toISOString().slice(0, 10);
  if (end.getUTCDate() !== 1) end.setUTCMonth(end.getUTCMonth() + 1, 1);
  return { trialEndsOn, firstPeriod: end.toISOString().slice(0, 7) };
}

module.exports = { trialDates };

function billingStatus(agency, profile = {}, today, enabledOn, initialPeriod) {
  const dates = trialDates(agency?.createdOn);
  const missing = ['taxId', 'legalName', 'address', 'condition', 'currency', 'amount'].filter(key => !profile[key]);
  if (dates && enabledOn) {
    const start = new Date(`${enabledOn}T12:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() + 1, 1);
    const firstPeriod = initialPeriod || start.toISOString().slice(0, 7);
    if (firstPeriod > dates.firstPeriod) dates.firstPeriod = firstPeriod;
  }
  let state;
  if (!agency) state = 'deleted';
  else if (agency.status !== 'active') state = 'suspended';
  else if (!dates) state = 'missing_date';
  else if (today < dates.trialEndsOn) state = 'trial';
  else if (missing.length) state = 'incomplete';
  else if (today.slice(0, 7) < dates.firstPeriod) state = 'scheduled';
  else state = 'ready';
  return { ...dates, state, missing };
}
module.exports.billingStatus = billingStatus;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const { parsePrice, SALE_CONDITIONS } = require('../../../../public/js/facturacion/billing-form.mjs');

function validateBillingProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Ficha fiscal invalida.');
  const result = {};
  const fields = ['taxId', 'legalName', 'address', 'condition', 'currency', 'amount', 'saleCondition'];
  for (const [key, value] of Object.entries(input)) {
    if (!fields.includes(key)) throw invalid('Campo fiscal no permitido.');
    if (key === 'amount') {
      if (value !== null && (!Number.isSafeInteger(value) || value <= 0 || value > 999999999999)) throw invalid('Importe invalido en centavos.');
      result[key] = value;
    } else {
      if (typeof value !== 'string' || value.length > 240) throw invalid('Dato fiscal invalido.');
      result[key] = value.trim();
    }
  }
  if (result.taxId) {
    const cuit = result.taxId.replace(/-/g, '');
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const check = (11 - weights.reduce((sum, weight, i) => sum + weight * Number(cuit[i]), 0) % 11) % 11;
    if (!/^\d{11}$/.test(cuit) || check > 9 || check !== Number(cuit[10])) throw invalid('CUIT invalido.');
    result.taxId = cuit;
  }
  if (result.condition && !['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'].includes(result.condition)) throw invalid('Condicion IVA invalida.');
  if (result.currency && !['ARS', 'USD'].includes(result.currency)) throw invalid('Moneda invalida.');
  if (result.saleCondition !== undefined && !SALE_CONDITIONS.includes(result.saleCondition)) throw invalid('Condicion de venta invalida.');
  return result;
}

module.exports.validateBillingProfile = validateBillingProfile;
module.exports.parsePrice = parsePrice;
module.exports.invalid = invalid;

function billingRecord(profile, previous, today) {
  const complete = ['taxId', 'legalName', 'address', 'condition', 'currency', 'amount'].every(key => profile[key]);
  const prices = [...(previous?.prices || [])];
  if (complete) {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() + 1, 1);
    const period = start.toISOString().slice(0, 7);
    const scheduled = billingProfileForPeriod(previous || {}, period);
    if (profile.amount !== scheduled.amount || profile.currency !== scheduled.currency) {
      const index = prices.findIndex(price => price.period === period);
      const price = { period, amount: profile.amount, currency: profile.currency };
      if (index < 0) prices.push(price); else prices[index] = price;
    }
  }
  return { profile, prices, enabledOn: complete ? previous?.enabledOn || today : null,
    ...(complete && previous?.enabledOn && previous?.initialPeriod ? { initialPeriod: previous.initialPeriod } : {}) };
}
module.exports.billingRecord = billingRecord;

// Solo para incorporar agencias ya facturadas fuera del sistema; no lo acepta el formulario.
function initialBillingRecord(input, agency, period, today) {
  if (period !== today.slice(0, 7) || !trialDates(today)) throw invalid('El corte inicial debe ser el mes actual.');
  const profile = validateBillingProfile(input);
  const record = { profile, enabledOn: today, initialPeriod: period,
    prices: [{ period, amount: profile.amount ?? null, currency: profile.currency || '' }] };
  if (billingStatus(agency, profile, today, record.enabledOn, period).state !== 'ready') throw invalid('La agencia no esta habilitada para el corte inicial.');
  return record;
}
module.exports.initialBillingRecord = initialBillingRecord;

function billingProfileForPeriod(record, period) {
  const price = (record.prices || []).filter(p => p.period <= period).sort((a, b) => b.period.localeCompare(a.period))[0];
  return { saleCondition: SALE_CONDITIONS[0], ...record.profile, amount: price?.amount ?? null, currency: price?.currency ?? '' };
}
module.exports.billingProfileForPeriod = billingProfileForPeriod;

function billingInvoice({ agency, record, period, today, salesPoint, quotation }) {
  if (period !== today.slice(0, 7)) throw invalid('Solo se puede emitir el mes actual.');
  if (!Number.isInteger(salesPoint) || salesPoint < 1 || salesPoint > 99998) throw invalid('Punto de venta invalido.');
  const profile = validateBillingProfile(billingProfileForPeriod(record, period));
  if (!record.enabledOn || billingStatus(agency, profile, today, record.enabledOn, record.initialPeriod).state !== 'ready') {
    throw invalid('La agencia no esta habilitada para facturar este mes.');
  }
  if (profile.currency === 'USD' && (quotation?.currencyId !== 'DOL' || !Number.isFinite(quotation.rate) || quotation.rate <= 0 || !/^\d{8}$/.test(quotation.date) || quotation.date >= today.replaceAll('-', ''))) {
    throw invalid('Falta cotizacion ARCA valida anterior a la emision.');
  }
  return {
    ...(profile.currency === 'USD' ? { paidInForeignCurrency: true, exchangeRate: String(quotation.rate) } : {}),
    issuer: 'monotributo', salesPoint, date: today,
    to: { condition: profile.condition, cuit: profile.taxId },
    concept: 'services', currency: profile.currency,
    service: { from: today, to: today, dueDate: today },
    items: [{ description: `Servicio TravelDocs - ${period}`, quantity: 1, amount: profile.amount,
      unitPrice: `${Math.floor(profile.amount / 100)}.${String(profile.amount % 100).padStart(2, '0')}` }],
  };
}
module.exports.billingInvoice = billingInvoice;
