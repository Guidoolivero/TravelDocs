export const SALE_CONDITIONS = ['Transferencia bancaria', 'Contado', 'Tarjeta de debito', 'Tarjeta de credito', 'Cuenta corriente', 'Cheque', 'Otra', 'Otros medios de pago electronico'];

export function parsePrice(value) {
  if (typeof value !== 'string' || !/^\d{1,10}([.,]\d{1,2})?$/.test(value)) throw new Error('Importe invalido: usar hasta dos decimales, sin separador de miles.');
  const [whole, decimal = ''] = value.replace(',', '.').split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('El importe debe ser mayor a cero.');
  return amount;
}

const CONDICIONES = { responsable_inscripto: 'Responsable inscripto', monotributo: 'Monotributista', exento: 'Exento', consumidor_final: 'Consumidor final' };

// Datos de la constancia de ARCA sobre la ficha: razon social y domicilio se reemplazan;
// la condicion IVA solo se completa si estaba vacia, para no pisar un cambio que ARCA
// todavia no refleja (ej. una agencia que pasa a RI el mes que viene).
export function aplicarPadron(actual, padron) {
  const avisos = [...(padron.errors || [])];
  let condition = actual.condition || padron.condition || '';
  if (actual.condition && padron.condition && actual.condition !== padron.condition) {
    avisos.push(`ARCA informa ${CONDICIONES[padron.condition]}; se mantiene ${CONDICIONES[actual.condition]}.`);
  }
  return { legalName: padron.legalName, address: padron.address, condition, aviso: avisos.join(' ') };
}
