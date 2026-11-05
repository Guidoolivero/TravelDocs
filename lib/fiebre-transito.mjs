// Politica de transito AEREO para el certificado de fiebre amarilla.
// No decide la entrada, la estadia ni el origen: eso sigue en la matriz.
//
// Fuente base, leida el 5 nov 2026:
// OMS, International Travel and Health, Annex 1, 18 nov 2022
// (revised 3 Jan 2023), countries with risk of yellow fever transmission.
//   nota 5: transito en aeropuerto de mas de 12 horas
//   nota 8: transito en aeropuerto de cualquier duracion
//   nota 9: Guyana, mas de 4 horas
//   nota 11: Paraguay, mas de 24 horas en Brasil, Bolivia, Peru o Venezuela
//     (en el cuadro el renglon se extrajo como "Yes7, 10"; la nota publicada es la 11)
// CDC Yellow Book, Guatemala and Belize, edicion 2026, pagina actualizada
// el 23 abr 2025: layovers o transitos de mas de 12 horas.
// El operador es estricto: 12 horas exactas no activan la nota 5.
//
// Correcciones posteriores a ese anexo, no se presentan como exencion universal:
// - El Salvador: el MINSAL elimino el certificado como requisito de ingreso
//   el 24 may 2024 (salud.gob.sv/fiebre-amarilla/). La nota 5 de 2022 no se reaplica.
// - Aruba: el codigo ya eximia el transito de aeropuerto o puerto
//   (airportaruba.com, excepcion 2). El anexo OMS le pone nota 5. Se conserva
//   la exencion de aeropuerto ya verificada en el producto y se marca como
//   excepcion, no como regla de los demas destinos.
// - Honduras: el INM (inm.gob.hn/visas.html, leido el 5 nov 2026) lista paises
//   de ingreso, Argentina y Panama incluidos, y no publica las 12 horas. La rama
//   de transito usa la nota 5 de la OMS. El ingreso sigue la celda de la matriz.

const MES = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const GT12 = [
  'DZA', 'ATG', 'AUS', 'BHS', 'BHR', 'BES', 'BRN', 'KHM', 'CHN', 'CXR',
  'COL', 'CUB', 'CUW', 'DJI', 'DMA', 'DOM', 'ECU', 'EGY', 'ETH', 'FJI',
  'PYF', 'GMB', 'GRD', 'GLP', 'GTM', 'HND', 'IRN', 'JAM', 'MDG', 'MWI',
  'MYS', 'MDV', 'MLT', 'MTQ', 'MYT', 'MOZ', 'MMR', 'NAM', 'NPL', 'OMN',
  'PAK', 'PHL', 'BLM', 'MAF', 'WSM', 'SAU', 'SGP', 'ZAF', 'LKA', 'SUR',
  'TZA', 'THA', 'ARE', 'VEN', 'WLF', 'ZMB', 'ZWE',
];

const CUALQUIERA = ['BGD', 'BWA', 'SWZ', 'IND', 'KAZ', 'MSR', 'NGA', 'PNG', 'STP', 'SEN', 'SYC'];

const POLITICA = new Map();
for (const iso of GT12) {
  POLITICA.set(iso, { op: 'gt', horas: 12, fuente: 'oms-nota-5', excepcion: '' });
}
for (const iso of CUALQUIERA) {
  POLITICA.set(iso, {
    op: 'any',
    fuente: 'oms-nota-8',
    excepcion: 'Este destino cuenta el transito en aeropuerto de un pais en riesgo sin minimo de horas (OMS, anexo 1, nota 8). No aplica la regla general de mas de 12 horas.',
  });
}
POLITICA.set('GUY', {
  op: 'gt',
  horas: 4,
  fuente: 'oms-nota-9',
  excepcion: 'Guyana cuenta el transito en aeropuerto de mas de 4 horas (OMS, anexo 1, nota 9), no de 12.',
});
POLITICA.set('PRY', {
  op: 'gt',
  horas: 24,
  solo: new Set(['BRA', 'BOL', 'PER', 'VEN']),
  fuente: 'oms-nota-11',
  excepcion: 'Paraguay, segun la OMS (anexo 1, nota 11), cuenta el transito de mas de 24 horas solo en Brasil, Bolivia, Peru o Venezuela.',
});
POLITICA.set('SLV', {
  op: 'none',
  fuente: 'minsal-2024',
  excepcion: 'El Salvador elimino el certificado como requisito de ingreso el 24 de mayo de 2024. El anexo OMS de 2022 no se vuelve a aplicar.',
});
POLITICA.set('ABW', {
  op: 'none',
  fuente: 'aeropuerto-aruba',
  excepcion: 'Aruba exime el transito por aeropuerto o puerto. Es una excepcion de ese destino: el anexo OMS de 2022 le asigna transito de mas de 12 horas y no se usa esa nota.',
});

export function politicaDe(iso3) {
  const iso = String(iso3 || '').trim().toUpperCase();
  return POLITICA.get(iso) || {
    op: 'none',
    fuente: 'sin-clausula-de-transito',
    excepcion: '',
  };
}

function partesFecha(fecha) {
  const s = String(fecha || '').trim().toUpperCase();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (iso) {
    return {
      y: +iso[1], m: +iso[2] - 1, d: +iso[3],
      hh: iso[4] == null ? null : +iso[4],
      mm: iso[5] == null ? null : +iso[5],
    };
  }
  const gds = s.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})?/);
  if (!gds || MES[gds[2]] == null) return null;
  const y = !gds[3] ? null : (gds[3].length <= 2 ? 2000 + +gds[3] : +gds[3]);
  return { y, m: MES[gds[2]], d: +gds[1], hh: null, mm: null };
}

function partesHora(hora) {
  const s = String(hora || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/) || s.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  const hh = +m[1];
  const mm = +m[2];
  if (hh > 23 || mm > 59) return null;
  return { hh, mm };
}

// Duracion en el reloj del aeropuerto de conexion, o en un mismo huso si las
// dos puntas ya vienen normalizadas (el PNR las guarda en hora de Argentina).
// Sin hora no se inventa un umbral. Dos fechas calendario o mas, sin hora,
// alcanzan para saber que no fue una escala del mismo dia.
export function minutosConexion(llega, sale) {
  const pArr = partesFecha(llega && (llega.fecha_llegada || llega.fecha));
  const pDep = partesFecha(sale && sale.fecha);
  if (!pArr || !pDep) return { minutos: null, sinHora: true };
  if (pArr.y == null && pDep.y == null) {
    pArr.y = 2026;
    pDep.y = 2026;
  } else if (pArr.y == null) pArr.y = pDep.y;
  else if (pDep.y == null) pDep.y = pArr.y;
  const dayA = Date.UTC(pArr.y, pArr.m, pArr.d);
  let dayB = Date.UTC(pDep.y, pDep.m, pDep.d);
  if (dayB + 180 * 86400000 < dayA) {
    pDep.y += 1;
    dayB = Date.UTC(pDep.y, pDep.m, pDep.d);
  }
  const hArr = partesHora(llega && llega.hora_llegada) || (pArr.hh == null ? null : { hh: pArr.hh, mm: pArr.mm });
  const hDep = partesHora(sale && sale.hora_salida) || (pDep.hh == null ? null : { hh: pDep.hh, mm: pDep.mm });
  if (hArr && hDep) {
    const a = Date.UTC(pArr.y, pArr.m, pArr.d, hArr.hh, hArr.mm);
    const b = Date.UTC(pDep.y, pDep.m, pDep.d, hDep.hh, hDep.mm);
    if (b < a) return { minutos: null, sinHora: true };
    return { minutos: Math.round((b - a) / 60000), sinHora: false };
  }
  const dias = Math.round((dayB - dayA) / 86400000);
  if (dias >= 2) return { minutos: dias * 1440, sinHora: false };
  return { minutos: null, sinHora: true };
}

export function conexionesDeSegmentos(segmentos, isoDeIata) {
  const legs = Array.isArray(segmentos) ? segmentos : [];
  const out = [];
  for (let i = 0; i < legs.length - 1; i++) {
    const iata = String(legs[i]?.destino || '').trim().toUpperCase();
    const sale = String(legs[i + 1]?.origen || '').trim().toUpperCase();
    if (!iata || iata !== sale) continue;
    const dur = minutosConexion(legs[i], legs[i + 1]);
    out.push({
      iata,
      iso: isoDeIata ? (isoDeIata(iata) || '') : '',
      minutos: dur.minutos,
      sinHora: !!dur.sinHora,
    });
  }
  return out;
}

const DIA = 24 * 60;

// 'cuenta' | 'ignora' | 'incierta' | 'estadia'
export function decisionTransito(isoDestino, transito) {
  const t = transito || {};
  if (t.ingreso) return 'estadia';
  if (t.minutos != null && t.minutos >= DIA) return 'estadia';
  const pol = politicaDe(isoDestino);
  if (pol.op === 'none') return 'ignora';
  if (pol.solo && !pol.solo.has(t.iso)) return 'ignora';
  if (pol.op === 'any') return 'cuenta';
  if (t.minutos != null && t.minutos > pol.horas * 60) return 'cuenta';
  if (t.sinHora || t.minutos == null) return 'incierta';
  return 'ignora';
}

export function textoTransito(isoDestino, transito, decision, lugar) {
  const pol = politicaDe(isoDestino);
  const donde = lugar || transito?.iata || transito?.iso || 'la conexion';
  if (decision === 'estadia') return '';
  if (decision === 'incierta') {
    const umbral = pol.op === 'gt'
      ? ` No se puede afirmar que supere las ${pol.horas} horas ni que no lo haga.`
      : '';
    return `Transito aereo en ${donde} sin horario de llegada y salida. No se inventa la duracion.${umbral}`;
  }
  const horas = transito?.minutos == null ? '' : ` (${formatoDuracion(transito.minutos)})`;
  if (decision === 'cuenta') {
    const extra = pol.excepcion ? ` ${pol.excepcion}` : '';
    return `El transito aereo en ${donde}${horas} entra en la regla de transito de este destino.${extra}`;
  }
  if (pol.op === 'gt') {
    const extra = pol.excepcion ? ` ${pol.excepcion}` : ' No es una exencion para todos los destinos: algunos cuentan cualquier duracion.';
    return `Transito aereo en ${donde}${horas}. Para este destino cuenta solo si dura mas de ${pol.horas} horas, asi que esta escala no lo activa.${extra}`;
  }
  if (pol.op === 'none' && pol.excepcion) {
    return `Transito aereo en ${donde}${horas}. ${pol.excepcion}`;
  }
  return '';
}

function formatoDuracion(minutos) {
  const m = Math.max(0, Math.round(minutos));
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (!h) return `${min} minutos`;
  if (!min) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h} h ${min} min`;
}
