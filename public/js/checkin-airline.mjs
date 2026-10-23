import { nombreAerolinea } from './airlines.mjs';

export function preparePdfAirline(segment) {
  const source = segment.companiaFuente;
  const code = String(segment.compania || '').trim().toUpperCase();
  const evidence = String(segment.companiaEvidencia || '').trim().slice(0, 240);
  const printed = String(segment.vueloDocumento || '').trim().toUpperCase().replace(/\s+/g, '');
  const name = nombreAerolinea(code);
  const plain = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const textualEvidence = name && (plain(evidence).includes(plain(name)) || new RegExp(`\\b${code}(?:\\s*\\d+)?\\b`).test(plain(evidence)));
  const explicit = source === 'texto' && !!textualEvidence;
  const suggested = source === 'logo' && evidence && nombreAerolinea(code) ? code : '';
  const flight = printed || String(segment.vuelo || '').toUpperCase().replace(/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])(?=\d)/, '');
  return {
    ...segment,
    vuelo: explicit && /^\d+$/.test(flight) ? code + flight : flight,
    compania: explicit ? code : '',
    companiaSugerida: suggested,
    companiaFuente: ['texto', 'logo'].includes(source) ? source : 'desconocida',
    companiaEvidencia: evidence,
    companiaPendiente: !explicit
  };
}

export function confirmAirline(leg, value) {
  const code = String(value || '').trim().toUpperCase();
  if (!nombreAerolinea(code)) throw new Error('Elegí un código de aerolínea reconocido.');
  return { ...leg, compania: code, companiaPendiente: false, vuelo: /^\d+$/.test(leg.vuelo) ? code + leg.vuelo : leg.vuelo };
}
