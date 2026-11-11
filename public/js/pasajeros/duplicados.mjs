import { estado } from '../compartido/estado.mjs';
import { normScanNumber } from '../documentos/identidad.mjs';

export function stripDiacritics(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function normDupName(v) {
  return stripDiacritics((v || '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim());
}

export function findDuplicateMatch(g, excludeId = null, candidates = estado.passengers) {
  const pargNum = normScanNumber(g.parg?.num || '');
  const pextNum = normScanNumber(g.pext?.num || '');
  const dniNum  = normScanNumber(g.dni?.num  || '');
  const dniCountry = g.dni?.country || 'ARG';
  const last    = normDupName(g.lastname  || '');
  const first   = normDupName(g.firstname || '');
  const dob     = g.dob || '';

  const original = excludeId ? candidates.find(p => p.id === excludeId) : null;
  const origParg = normScanNumber(original?.parg?.num || '');
  const origPext = normScanNumber(original?.pext?.num || '');
  const origDni  = normScanNumber(original?.dni?.num  || '');

  for (const p of candidates) {
    if (excludeId && p.id === excludeId) continue;

    const existParg = normScanNumber(p.parg?.num || '');
    const existPext = normScanNumber(p.pext?.num || '');
    const existDni  = normScanNumber(p.dni?.num  || '');

    if (pargNum && pargNum !== origParg && (pargNum === existParg || pargNum === existPext)) {
      return { passenger: p, reason: 'parg' };
    }
    if (pextNum && pextNum !== origPext && (pextNum === existParg || pextNum === existPext)) {
      return { passenger: p, reason: 'pext' };
    }
    // DNI: mismo número pero de distinto país (ej. DNI ARG vs cédula CHL) no es duplicado
    if (dniNum && dniNum !== origDni && dniNum === existDni && dniCountry === (p.dni?.country || 'ARG')) {
      return { passenger: p, reason: 'dni' };
    }
    if (last && first && dob &&
        last  === normDupName(p.lastname  || '') &&
        first === normDupName(p.firstname || '') &&
        dob   === (p.dob || '')) {
      return { passenger: p, reason: 'identity' };
    }
  }
  return null;
}

export function findDuplicateInDB(g, excludeId = null) {
  return findDuplicateMatch(g, excludeId)?.passenger || null;
}
