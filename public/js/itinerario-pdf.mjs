// Texto de un itinerario (no el binario).
// Primero el emitido "Flight N". Si no, un e-ticket o un "Su viaje":
// numero de vuelo, dos aeropuertos y la fecha.
// ponytail: si falta el anio, se usa el calendario de Argentina y el tramo anterior.
// Un enero despues de un diciembre pasa al ano siguiente. No lee el anio del billete.
// No toma un vuelo de menos de 3 digitos, ni un codigo de una letra (U2, 6E).
// E-ticket AA/wkhtmltopdf: vuelo sin carrier + "codigo de reserva es AA......"
// (el numero solo se toma si hay un mes cerca y no es avion/Boeing/Airbus).

const MESES = {
  january: 'JAN', february: 'FEB', march: 'MAR', april: 'APR',
  may: 'MAY', june: 'JUN', july: 'JUL', august: 'AUG',
  september: 'SEP', october: 'OCT', november: 'NOV', december: 'DEC',
};

const MES_NUM = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

const MES_IDX = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const MES_LARGO = {
  enero: 'JAN', febrero: 'FEB', marzo: 'MAR', abril: 'APR', mayo: 'MAY',
  junio: 'JUN', julio: 'JUL', agosto: 'AUG', septiembre: 'SEP', setiembre: 'SEP',
  octubre: 'OCT', noviembre: 'NOV', diciembre: 'DEC',
  january: 'JAN', february: 'FEB', march: 'MAR', april: 'APR', may: 'MAY',
  june: 'JUN', july: 'JUL', august: 'AUG', september: 'SEP', october: 'OCT',
  november: 'NOV', december: 'DEC',
};

const MES_CORTO = {
  ENE: 'JAN', FEB: 'FEB', MAR: 'MAR', ABR: 'APR', MAY: 'MAY', JUN: 'JUN',
  JUL: 'JUL', AGO: 'AUG', SEP: 'SEP', SET: 'SEP', OCT: 'OCT', NOV: 'NOV',
  DIC: 'DEC', JAN: 'JAN', APR: 'APR', AUG: 'AUG', DEC: 'DEC',
};

const NOMBRES_MES = Object.keys(MES_LARGO).join('|');

// IATA suelto. (XXX) usa la misma lista. XXX-- se acepta igual (e-ticket chino).
// ponytail: un aeropuerto raro escrito solo, sin parentesis ni "--", no entra.
const IATA = new Set(`
EZE AEP COR MDZ ROS BRC IGR NQN SLA TUC USH FTE CPC
GRU GIG SCL LIM BOG UIO ASU MVD MEX CUN PTY SJO
MIA JFK LAX ORD MCO FLL
PDX DFW ATL BOS CLT DEN IAH LAS PHX SEA SFO IAD DTW MSP PHL SAN SLC
MAD BCN FCO MXP CDG ORY LHR LGW AMS FRA LIS ZRH VCE
AUA CUR PUJ NAS
PVG HND NRT PEK HKG DOH DXB IST AUH
`.split(/\s+/).filter(Boolean));

const ALIAS = [
  ['ministro pistarini', 'EZE'],
  ['ezeiza', 'EZE'],
  ['jorge newbery', 'AEP'],
  ['aeroparque', 'AEP'],
  ['fiumicino', 'FCO'],
  ['leonardo da vinci', 'FCO'],
  ['reina beatriz', 'AUA'],
  ['jorge chavez', 'LIM'],
  ['tocumen', 'PTY'],
  ['barajas', 'MAD'],
  ['el prat', 'BCN'],
  ['charles de gaulle', 'CDG'],
  ['roissy', 'CDG'],
  ['orly', 'ORY'],
  ['heathrow', 'LHR'],
  ['gatwick', 'LGW'],
  ['schiphol', 'AMS'],
  ['guarulhos', 'GRU'],
  ['galeao', 'GIG'],
  ['arturo merino', 'SCL'],
  ['pudahuel', 'SCL'],
  ['el dorado', 'BOG'],
  ['mariscal sucre', 'UIO'],
  ['silvio pettirossi', 'ASU'],
  ['carrasco', 'MVD'],
  ['haneda', 'HND'],
  ['narita', 'NRT'],
  ['pudong', 'PVG'],
  ['osaka kansai', 'KIX'],
  ['hong kong', 'HKG'],
  ['cancun', 'CUN'],
  ['punta cana', 'PUJ'],
  ['malpensa', 'MXP'],
];

// Palabras que parecen un codigo de aerolinea y no lo son.
const NO_VUELO = new Set(['OF', 'OR', 'TO', 'AT', 'IN', 'ON', 'BY', 'XT', 'YQ', 'YR']);

// "Su codigo de reserva es AAJHRWDO" -> AA. ETK 001... -> AA (stock AA).
function carrierDeReserva(texto) {
  const pnr = String(texto || '').match(/c[oó]digo de reserva es\s*([A-Z]{2})([A-Z0-9]{6})\b/i);
  if (pnr) return pnr[1].toUpperCase();
  const etk = String(texto || '').match(/\bETK:\s*(\d{3})\d+/i);
  if (etk && etk[1] === '001') return 'AA';
  return '';
}

function parseEmitido(texto) {
  const partes = String(texto || '').split(/Flight\s+\d+/i).slice(1);
  const out = [];
  for (const bloque of partes) {
    const cuerpo = bloque.split(/Passengers/i)[0];
    const fm = cuerpo.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
    const vm = cuerpo.match(/\b([A-Z][A-Z0-9]|[A-Z0-9][A-Z])\s*(\d{1,4})\b/);
    const iatas = cuerpo.match(/\b[A-Z]{3}\b/g) || [];
    if (!fm || !vm || iatas.length < 2) continue;
    const mes = MESES[fm[2].toLowerCase()];
    if (!mes) continue;
    out.push({
      vuelo: vm[1] + vm[2],
      origen: iatas[0],
      destino: iatas[1],
      fecha: fm[1].padStart(2, '0') + mes + fm[3].slice(-2),
    });
  }
  return out;
}

function plano(s) {
  return s.replace(/[ÁÉÍÓÚÜÑáéíóúüñ]/g, c => ({
    Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ú: 'u', Ü: 'u', Ñ: 'n',
    á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n',
  }[c])).toLowerCase();
}

function anclas(texto) {
  const out = [];
  for (const m of texto.matchAll(/\b(\d{3,4})\s*\(\s*Operado\s+por\s+LAN/gi)) {
    out.push({ i: m.index, fin: m.index + m[0].length, vuelo: 'LA' + m[1] });
  }
  for (const m of texto.matchAll(/\b([A-Z]{2})\s*(\d{3,4})\b(?![\d-])(?!\.\d)/gi)) {
    const carrier = m[1].toUpperCase();
    if (NO_VUELO.has(carrier)) continue;
    const antes = texto.slice(Math.max(0, m.index - 48), m.index);
    if (/operado\s+por/i.test(antes)) continue;
    if (out.some(a => m.index >= a.i && m.index < a.fin)) continue;
    out.push({ i: m.index, fin: m.index + m[0].length, vuelo: carrier + m[2] });
  }
  // E-ticket sin "AA 954": el carrier viene del PNR/ETK y el numero va junto al mes.
  const carrierReserva = carrierDeReserva(texto);
  if (carrierReserva) {
    const reMes = new RegExp(`\\b(${NOMBRES_MES})\\b`, 'i');
    for (const m of texto.matchAll(/\b(\d{3,4})\b/g)) {
      const i = m.index;
      if (out.some(a => i >= a.i && i < a.fin)) continue;
      const ventana = texto.slice(Math.max(0, i - 48), i + m[0].length + 48);
      if (!reMes.test(ventana)) continue;
      const cerca = texto.slice(Math.max(0, i - 24), i + m[0].length + 12);
      if (/boeing|airbus|\bavion\b/i.test(cerca)) continue;
      if (/-\s*$/.test(texto.slice(Math.max(0, i - 4), i))) continue;
      out.push({ i, fin: i + m[0].length, vuelo: carrierReserva + m[1] });
    }
  }
  out.sort((a, b) => a.i - b.i);
  return out;
}

function aeropuertos(texto, desde, hasta) {
  if (hasta <= desde) return [];
  const trozo = texto.slice(desde, hasta);
  const low = plano(trozo);
  const hits = [];
  const add = (i, code) => hits.push({ i, code });
  for (const m of trozo.matchAll(/\b([A-Z]{3})--/gi)) add(m.index, m[1].toUpperCase());
  for (const m of trozo.matchAll(/\(([A-Z]{3})\)/gi)) {
    const code = m[1].toUpperCase();
    if (IATA.has(code)) add(m.index, code);
  }
  for (const [nombre, code] of ALIAS) {
    let p = 0;
    while (p < low.length) {
      const i = low.indexOf(nombre, p);
      if (i < 0) break;
      const antes = i > 0 ? low[i - 1] : '';
      const despues = low[i + nombre.length] || '';
      if (!/[a-záéíóúñ]/.test(antes) && !/[a-záéíóúñ]/.test(despues)) add(i, code);
      p = i + nombre.length;
    }
  }
  for (const m of trozo.matchAll(/\b([A-Z]{3})\b/gi)) {
    const code = m[1].toUpperCase();
    if (IATA.has(code)) add(m.index, code);
  }
  hits.sort((a, b) => a.i - b.i);
  return hits.map(h => h.code);
}

function distintos(codes) {
  const out = [];
  for (const c of codes) if (!out.includes(c)) out.push(c);
  return out;
}

function hoyART(ahora) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ahora));
  const n = t => +parts.find(p => p.type === t).value;
  return { anio: n('year'), mesIdx: n('month') - 1, dia: n('day') };
}

function fechasEn(trozo, base) {
  const out = [];
  const poner = (i, dia, mes, anio) => {
    if (!mes || dia < 1 || dia > 31) return;
    const prev = out.find(x => x.i === i && x.dia === dia && x.mes === mes);
    if (prev) {
      if (!prev.anio && anio) prev.anio = anio;
      return;
    }
    out.push({ i, dia, mes, anio: anio || 0 });
  };
  const reAnio = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${NOMBRES_MES})(?:\\s+de)?\\s+(\\d{4})\\b`, 'gi');
  for (const m of trozo.matchAll(reAnio)) {
    poner(base + m.index, +m[1], MES_LARGO[m[2].toLowerCase()], +m[3]);
  }
  const reSin = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${NOMBRES_MES})\\b`, 'gi');
  for (const m of trozo.matchAll(reSin)) {
    poner(base + m.index, +m[1], MES_LARGO[m[2].toLowerCase()], 0);
  }
  for (const m of trozo.matchAll(/\b(\d{1,2})(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC|JAN|APR|AUG|DEC)(\d{2,4})?\b/gi)) {
    const crudo = m[3] ? +m[3] : 0;
    const anio = crudo ? (crudo < 100 ? 2000 + crudo : crudo) : 0;
    poner(base + m.index, +m[1], MES_CORTO[m[2].toUpperCase()], anio);
  }
  return out;
}

function anioDe(mes, dia, explicito, hoy, anterior) {
  if (explicito) return explicito;
  const idx = MES_IDX[mes];
  if (anterior) return idx < anterior.idx ? anterior.anio + 1 : anterior.anio;
  const pasado = idx < hoy.mesIdx || (idx === hoy.mesIdx && dia < hoy.dia);
  return pasado ? hoy.anio + 1 : hoy.anio;
}

function fechaDe(texto, desde, hasta, vueloI, hoy, anterior) {
  const cands = fechasEn(texto.slice(desde, hasta), desde);
  let pick = null;
  if (cands.length) {
    const dist = c => Math.abs(c.i - vueloI);
    cands.sort((a, b) => dist(a) - dist(b) || (b.anio - a.anio));
    pick = cands[0];
    if (!pick.anio) {
      const misma = cands.filter(c => c.anio && c.dia === pick.dia && c.mes === pick.mes && dist(c) <= 80);
      if (misma.length) pick = misma.sort((a, b) => dist(a) - dist(b))[0];
    }
  } else {
    const trozo = texto.slice(desde, hasta);
    let mesHit = null;
    for (const m of trozo.matchAll(new RegExp(`\\b(${NOMBRES_MES})\\b`, 'gi'))) {
      const mes = MES_LARGO[m[1].toLowerCase()];
      const i = desde + m.index;
      if (!mesHit || Math.abs(i - vueloI) < Math.abs(mesHit.i - vueloI)) mesHit = { i, mes };
    }
    let diaHit = null;
    for (const m of trozo.matchAll(/(?<![\d:])\b(\d{1,2})\b(?![:hm])/g)) {
      const dia = +m[1];
      if (dia < 1 || dia > 31) continue;
      const i = desde + m.index;
      if (!diaHit || Math.abs(i - vueloI) < Math.abs(diaHit.i - vueloI)) diaHit = { i, dia };
    }
    if (!mesHit || !diaHit) return null;
    pick = { dia: diaHit.dia, mes: mesHit.mes, anio: 0 };
  }
  if (!pick) return null;
  return { dia: pick.dia, mes: pick.mes, anio: anioDe(pick.mes, pick.dia, pick.anio, hoy, anterior) };
}

function parseProsa(texto, ahora) {
  const lista = anclas(texto);
  if (!lista.length) return [];
  const hoy = hoyART(ahora);
  const out = [];
  let anterior = null;
  for (let n = 0; n < lista.length; n++) {
    const a = lista[n];
    const desde = n ? lista[n - 1].i : 0;
    const hasta = n + 1 < lista.length ? lista[n + 1].i : texto.length;
    const ad = distintos(aeropuertos(texto, a.i, hasta));
    const at = distintos(aeropuertos(texto, desde, a.i));
    const par = (ad.length >= 2 ? ad : distintos(at.concat(ad))).slice(0, 2);
    if (par.length < 2) continue;
    const fecha = fechaDe(texto, desde, hasta, a.i, hoy, anterior);
    if (!fecha) continue;
    anterior = { idx: MES_IDX[fecha.mes], anio: fecha.anio };
    out.push({
      vuelo: a.vuelo,
      origen: par[0],
      destino: par[1],
      fecha: String(fecha.dia).padStart(2, '0') + fecha.mes + String(fecha.anio).slice(-2),
    });
  }
  return out;
}

export function parseItinerarioTexto(texto, ahora = Date.now()) {
  const emitido = parseEmitido(texto);
  if (emitido.length) return emitido;
  return parseProsa(String(texto || ''), ahora);
}

export function fechaIso(fechaGds) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(fechaGds || '');
  const mm = m && MES_NUM[m[2]];
  return mm ? `20${m[3]}-${mm}-${m[1]}` : '';
}

// En una foto, octubre suele salir 0ct. Solo se usa en ese texto.
export function normalizarOcr(texto) {
  return String(texto || '')
    .replace(/(\d)0ct/gi, '$1Oct')
    .replace(/\b0ct/gi, 'Oct');
}

// pdf, foto del agente, o nada. El SVG no es una foto.
export function claseItinerario(file) {
  const type = String(file && file.type || '').toLowerCase();
  const name = String(file && file.name || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return '';
  if (type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/.test(name)) return 'imagen';
  return '';
}

// Orden del PDF (el de arriba de la pagina siguiente no se adelanta).
export function textoDesdeItems(items) {
  const lineas = [];
  let linea = '';
  let lastY = null;
  for (const it of items || []) {
    const s = it && it.str ? String(it.str) : '';
    if (!s) continue;
    const y = it.transform ? it.transform[5] : null;
    if (lastY != null && y != null && Math.abs(y - lastY) > 2 && linea) {
      lineas.push(linea);
      linea = '';
    }
    if (linea && !linea.endsWith(' ') && !s.startsWith(' ')) linea += ' ';
    linea += s;
    if (it.hasEOL) {
      lineas.push(linea);
      linea = '';
      lastY = null;
      continue;
    }
    if (y != null) lastY = y;
  }
  if (linea) lineas.push(linea);
  return lineas.join('\n');
}
