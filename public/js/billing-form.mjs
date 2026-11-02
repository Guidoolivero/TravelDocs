export const SALE_CONDITIONS = ['Transferencia bancaria', 'Contado', 'Tarjeta de debito', 'Tarjeta de credito', 'Cuenta corriente', 'Cheque', 'Otra', 'Otros medios de pago electronico'];

export function parsePrice(value) {
  if (typeof value !== 'string' || !/^\d{1,10}([.,]\d{1,2})?$/.test(value)) throw new Error('Importe invalido: usar hasta dos decimales, sin separador de miles.');
  const [whole, decimal = ''] = value.replace(',', '.').split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('El importe debe ser mayor a cero.');
  return amount;
}
