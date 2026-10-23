import { AIRLINES, nombreAerolinea } from './airlines.mjs';

const plain = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function writtenNames(text) {
  return Object.entries(AIRLINES).filter(([, name]) => new RegExp(`\\b${escapeRegex(plain(name))}\\b`).test(text)).map(([code]) => code);
}

export function preparePdfAirline(segment, pdfText = '') {
  const lines = String(pdfText).split(/\r?\n/).filter(line => !/^\s*(localizador|booking reference|record locator|pnr|etk|e[- ]?ticket|billete|emitido por|issued by|issuing carrier|validating carrier)\b/i.test(line));
  const text = plain(lines.join('\n'));
  const raw = plain(segment.vueloDocumento || segment.vuelo).replace(/\s+/g, '');
  const number = raw.match(/(\d{1,4}[A-Z]?)$/)?.[1] || '';
  const flightCodes = number ? [...text.matchAll(new RegExp(`\\b([A-Z][A-Z0-9]|[0-9][A-Z])\\s*${escapeRegex(number)}\\b`, 'g'))]
    .map(m => m[1]).filter(code => nombreAerolinea(code)) : [];
  const codes = [...new Set(flightCodes)];
  const numberPattern = new RegExp(`(^|[^0-9])${escapeRegex(number)}\\b`);
  const adjacent = number ? lines.flatMap((line, i) => numberPattern.test(plain(line)) ? [lines[i - 1] || '', line] : []) : [];
  const names = writtenNames(plain(adjacent.filter(line => !/emitido por|emisora?|issued by|issuing carrier|validating carrier|pasajero|passenger/i.test(line)).join('\n')));
  const labelled = [...new Set([...plain(adjacent.join('\n')).matchAll(/\b(?:AEROLINEA|COMPANIA(?: AEREA)?|AIRLINE|CARRIER)\s*:?\s*([A-Z][A-Z0-9]|[0-9][A-Z])\b/g)].map(m => m[1]).filter(code => nombreAerolinea(code)))];
  const quote = plain(segment.companiaEvidencia);
  const candidate = plain(segment.compania);
  const operatorText = quote.match(/(?:OPERAD[OA] POR|OPERATED BY)\s+(.+)$/)?.[1] || '';
  const operator = quote && text.includes(quote) && number &&
    new RegExp(`\\b(?:(?:[A-Z][A-Z0-9]|[0-9][A-Z])\\s*)?${escapeRegex(number)}\\b`).test(quote) &&
    nombreAerolinea(candidate) && (writtenNames(operatorText).includes(candidate) || new RegExp(`^${escapeRegex(candidate)}\\b`).test(operatorText));
  let code = '';
  if (operator) code = candidate;
  else if (codes.length === 1 && (!labelled.length || labelled.includes(codes[0]))) code = codes[0];
  else if (!codes.length && labelled.length === 1) code = labelled[0];
  else if (!codes.length && !labelled.length && names.length === 1) code = names[0];
  // Solo se conserva un prefijo si aparece escrito con ese numero en el PDF.
  const flight = codes.length === 1 ? codes[0] + number : number;
  const result = {
    ...segment,
    vuelo: code && /^\d+$/.test(flight) ? code + flight : flight,
    compania: code,
    companiaPendiente: !code,
    companiaFuente: code ? 'texto' : 'desconocida',
    companiaEvidencia: code ? (operator ? segment.companiaEvidencia : codes.length === 1 ? flight : nombreAerolinea(code)) : ''
  };
  delete result.companiaSugerida;
  return result;
}

export function confirmAirline(leg, value) {
  const code = String(value || '').trim().toUpperCase();
  if (!nombreAerolinea(code)) throw new Error('Elegí un código de aerolínea reconocido.');
  return { ...leg, compania: code, companiaPendiente: false, vuelo: /^\d+$/.test(leg.vuelo) ? code + leg.vuelo : leg.vuelo };
}
