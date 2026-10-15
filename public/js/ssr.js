// ============================================================
//  ssr.js — Strings SSR / FOID para GDS (Amadeus, Sabre, Galileo)
//  Formatos confirmados por el usuario (Res. IATA 830D + manuales).
//  Amadeus se preserva idéntico al original; Sabre y Galileo son nuevos.
// ============================================================
import { fmtDateGDS } from './utils.js';

function stripDiacritics(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// ISO 3166-1 alpha-3 \u2192 alpha-2. Sabre y Galileo usan 2 letras en DOCS/FOID;
// el substring(0,2) anterior era incorrecto para varios pa\u00edses (CHL\u2192CH, MEX\u2192ME, URY\u2192UR...).
const ALPHA2 = {
  ARG: 'AR', BOL: 'BO', BRA: 'BR', CHL: 'CL', COL: 'CO', ECU: 'EC', GUY: 'GY',
  PRY: 'PY', PER: 'PE', SUR: 'SR', URY: 'UY', VEN: 'VE', ITA: 'IT', ESP: 'ES',
  DEU: 'DE', FRA: 'FR', PRT: 'PT', GBR: 'GB', USA: 'US', MEX: 'MX'
};
function alpha2(c) { return ALPHA2[String(c || '').toUpperCase()] || String(c || '').substring(0, 2); }

const DEFAULT_CTX = { gds: 'amadeus', pnum: '1', snum: '1', infPnum: '2' };
let _ctx = { ...DEFAULT_CTX };

function getGDS() { return _ctx.gds; }
function getPnum() { return _ctx.pnum; }
function getSnum() { return _ctx.snum; }
function getInfPnum() { return _ctx.infPnum; }

// Fecha GDS con año de 4 dígitos (DDMMMYYYY) — Sabre DOCO usa este formato.
// No toca fmtDateGDS de utils.js (que usan los tests).
function fmtDateGDS4(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return d.getDate().toString().padStart(2,'0') + months[d.getMonth()] + d.getFullYear();
}

// Asociación de pasajero por GDS (va al final del string):
//  Amadeus: /P{pnum}     Sabre: -{pnum}.1 (name number línea.orden)     Galileo: '' (va en el prefijo)
function paxSuffix() {
  const g = getGDS(), p = getPnum();
  if (g === 'sabre') return `-${p}.1`;
  if (g === 'galileo') return '';
  return `/P${p}`;
}

// Prefijo de Galileo: SI.P{pnum}S{snum}/{type}*  (para DOCS). pnum opcional (infante).
function galileoPrefix(type, pnum) {
  const p = pnum || getPnum();
  return `SI.P${p}S${getSnum()}/${type}*`;
}

// ── SRDOCS (pasaporte completo) ─────────────────────────────
//  Amadeus: SRDOCSYYHK1-P-{PAIS}-{num}-{nat}-{dob}-{sex}-{exp}-{apellido}-{nombre}/P{n}
//  Sabre:   3DOCS/P/{pais}/{num}/{nat}/{dob}/{sex}/{exp}/{apellido}/{nombre}-{pax}
//  Galileo: SI.P{n}S{seg}/DOCS*P/{pais}/{num}/{nat}/{dob}/{sex}/{exp}/{apellido}/{nombre}
export function generateSRDOCS(p, passportCountry) {
  const g = getGDS();
  // Para pasaporte extranjero: usar el nombre de ese pasaporte si esta cargado (fallback al principal).
  const useForeign = passportCountry !== 'ARG' && p.pext?.lastname;
  const nombre = stripDiacritics(useForeign ? (p.pext.firstname || p.firstname || '') : (p.firstname || ''));
  const apellido = stripDiacritics(useForeign ? (p.pext.lastname || p.lastname || '') : (p.lastname || ''));
  let country, num, exp;
  if (passportCountry === 'ARG') {
    if (!p.parg?.num) return '';
    country = 'ARG'; num = p.parg.num; exp = p.parg.exp;
  } else {
    if (!p.pext?.num || p.pext.country !== passportCountry) return '';
    country = passportCountry; num = p.pext.num; exp = p.pext.exp;
  }
  const nat = p.nationality || 'ARG';
  const dob = fmtDateGDS(p.dob);
  const expF = fmtDateGDS(exp);
  if (g === 'sabre') {
    return `3DOCS/P/${alpha2(country)}/${num}/${alpha2(nat)}/${fmtDateGDS4(p.dob)}/${p.gender}/${fmtDateGDS4(exp)}/${apellido}/${nombre}${paxSuffix()}`;
  }
  if (g === 'galileo') {
    return `${galileoPrefix('DOCS')}P/${country}/${num}/${nat}/${dob}/${p.gender}/${expF}/${apellido}/${nombre}`;
  }
  return `SRDOCSYYHK1-P-${country}-${num}-${nat}-${dob}-${p.gender}-${expF}-${apellido}-${nombre}${paxSuffix()}`;
}

// ── SRDOCS corto (solo apellido/nombre/sexo/fecha nac.) ─────
//  Amadeus: SRDOCSYYHK1-----{dob}-{sex}--{apellido}-{nombre}/P{n}
//  Sabre:   3DOCS/DB/{dob}/{sex}//{apellido}/{nombre}-{pax}.1
//  Galileo: omitido
export function generateSRDOCSShort(p) {
  const g = getGDS();
  if (!p.dob || !p.gender) return '';
  const apellido = stripDiacritics(p.lastname || '');
  const nombre = stripDiacritics(p.firstname || '');
  const dob = fmtDateGDS(p.dob);
  if (g === 'sabre') {
    return `3DOCS/DB/${dob}/${p.gender}//${apellido}/${nombre}${paxSuffix()}`;
  }
  if (g === 'amadeus') {
    return `SRDOCSYYHK1-----${dob}-${p.gender}--${apellido}-${nombre}/P${getPnum()}`;
  }
  return '';
}

// ── DNI como DOCS tipo I (Amadeus / Sabre / Galileo) ───────
//  Amadeus: SRDOCSYYHK1-I-ARG-{num}-{nat}-{dob2}-{sex}-{exp2}-{apellido}-{nombre}/P{n}
//  Sabre:   3DOCS/I/AR/{num}/{nat2}/{dob4}/{sex}/{exp4}/{apellido}/{nombre}-{pax}  (2 letras + año 4 dígitos)
//  Galileo: SI.P{n}S{seg}/DOCS*I/AR/{num}/{nat}/{dob2}/{sex}/{exp2}/{apellido}/{nombre}
//  El vencimiento proviene de p.dni.exp (dato que ya carga el formulario).
//  País emisor: p.dni.country (DNI de cualquier país); default ARG para datos existentes.
function generateDNIDocs(p) {
  const g = getGDS();
  if (!p.dni?.num) return '';
  const country = p.dni.country || 'ARG';
  const nombre = stripDiacritics(p.firstname || '');
  const apellido = stripDiacritics(p.lastname || '');
  const nat = p.nationality || 'ARG';
  const dob = fmtDateGDS(p.dob);
  const expF = fmtDateGDS(p.dni.exp);
  if (g === 'sabre') {
    return `3DOCS/I/${alpha2(country)}/${p.dni.num}/${alpha2(nat)}/${fmtDateGDS4(p.dob)}/${p.gender}/${fmtDateGDS4(p.dni.exp)}/${apellido}/${nombre}${paxSuffix()}`;
  }
  if (g === 'galileo') {
    return `${galileoPrefix('DOCS')}I/${alpha2(country)}/${p.dni.num}/${nat}/${dob}/${p.gender}/${expF}/${apellido}/${nombre}`;
  }
  return `SRDOCSYYHK1-I-${country}-${p.dni.num}-${nat}-${dob}-${p.gender}-${expF}-${apellido}-${nombre}${paxSuffix()}`;
}

// ── SRFOID / FOID ───────────────────────────────────────────
//  Amadeus DNI:  SRFOIDYYHK1-NI{nat2}{dni}/P{n}     (nat2 = 2 letras nacionalidad)
//  Amadeus PP:   SRFOIDYYHK1-PP{pasaporte}/P{n}
//  Sabre PP:     3FOID/PP{nat2}{pasaporte}-{pax}     (solo LAN)
//  Sabre DNI:    no existe FOID con DNI (va como DOCS/I)
//  Galileo:      FOID omitido
export function generateSRFOID(p, type) {
  const g = getGDS();
  const nat2 = alpha2(p.nationality || 'ARG');
  if (type === 'NI') {
    if (g !== 'amadeus') return '';
    if (!p.dni?.num) return '';
    return `SRFOIDYYHK1-NI${nat2}${p.dni.num}${paxSuffix()}`;
  }
  if (!p.parg?.num) return '';
  if (g === 'sabre') return `3FOID/PP${nat2}${p.parg.num}${paxSuffix()}`;
  if (g === 'galileo') return '';
  return `SRFOIDYYHK1-PP${p.parg.num}${paxSuffix()}`;
}

// ── SRDOCO / DOCO (visa) ────────────────────────────────────
//  Amadeus: SRDOCOYYHK1-{lugar}-V-{num}-{lugar}-{emi2d}-{pais}/P{n}          (2 dígitos, sin venc)
//  Sabre:   3DOCO{seg}/{nacionalidad}/V/{num}/{lugarEmi}/{emi4d}/{pais}//{venc4d}-{pax}  (lugarNac=nacionalidad)
//  Galileo: SI.DOCO*{lugar}/V/{num}/{lugar}/{emi2d}/{pais}                    (sin pax, sin venc)
export function generateSRDOCO(p, visa) {
  if (!visa?.country || !visa?.num) return '';
  const g = getGDS();
  const issuedAt = (visa.issued_at || 'BUENOS AIRES ARG').toUpperCase();
  if (g === 'sabre') {
    const birthPlace = (p.nationality || 'ARG').toUpperCase();
    const issueDate = visa.issue ? fmtDateGDS4(visa.issue) : '';
    const expDate = visa.exp ? fmtDateGDS4(visa.exp) : '';
    return `3DOCO${getSnum()}/${birthPlace}/V/${visa.num}/${issuedAt}/${issueDate}/${visa.country}//${expDate}${paxSuffix()}`;
  }
  if (g === 'galileo') {
    return `SI.DOCO*${issuedAt}/V/${visa.num}/${issuedAt}/${fmtDateGDS(visa.issue)}/${visa.country}`;
  }
  return `SRDOCOYYHK1-${issuedAt}-V-${visa.num}-${issuedAt}-${fmtDateGDS(visa.issue)}-${visa.country}${paxSuffix()}`;
}

// ── SRCTCE / CTCE (email de contacto) ───────────────────────
//  Amadeus: SRCTCEYYHK1-{email codificada}/P{n}
//  Sabre:   3CTCE/{email codificada}-{pax}
//  Galileo: omitido
//  Codificacion IATA de electronic address: @ → //, _ → .., - → ./
function encodeEmailCTCE(email) {
  return email.replace(/@/g, '//').replace(/_/g, '..').replace(/-/g, './');
}

export function generateSRCTCE(p) {
  if (!p.email || !p.email.includes('@')) return '';
  const g = getGDS();
  if (g === 'galileo') return '';
  const encoded = encodeEmailCTCE(p.email);
  if (g === 'sabre') return `3CTCE/${encoded}${paxSuffix()}`;
  return `SRCTCEYYHK1-${encoded}${paxSuffix()}`;
}

// ── SRCTCM / CTCM (celular) ─────────────────────────────────
//  Amadeus: SRCTCMYYHK1-{num}/P{n}    (limpio: sin espacios/guiones/+/())
//  Sabre:   3CTCM/{num}-{pax}         (sin guiones ni +; espacios permitidos)
//  Galileo: omitido
export function generateCTCM(p) {
  if (!p.whatsapp) return '';
  const g = getGDS();
  if (g === 'galileo') return '';
  if (g === 'sabre') {
    const clean = p.whatsapp.replace(/[-+]/g, '');
    if (!clean) return '';
    return `3CTCM/${clean}${paxSuffix()}`;
  }
  const clean = p.whatsapp.replace(/[\s\-\(\)\+]/g, '');
  if (!clean) return '';
  return `SRCTCMYYHK1-${clean}${paxSuffix()}`;
}

// ── FFN (Viajero Frecuente) ─────────────────────────────────
//  Amadeus: FFN{cia}-{num}/P{n}
//  Sabre:   FF{cia}{num}-{pax}
//  Galileo: omitido
export function generateFFN(p, ffn) {
  if (!ffn?.airline || !ffn?.number) return '';
  const g = getGDS();
  if (g === 'galileo') return '';
  const airline = ffn.airline.toUpperCase();
  if (g === 'sabre') return `FF${airline}${ffn.number}${paxSuffix()}`;
  return `FFN${airline}-${ffn.number}${paxSuffix()}`;
}

// ── NM Infante (nombre PNR — igual en los 3 GDS) ────────────
export function generateInfantNM(adult, infant) {
  if (!infant) return '';
  return `NM1${stripDiacritics(adult.lastname)}/${stripDiacritics(adult.firstname)}(INFS${stripDiacritics(infant.lastname)}/${stripDiacritics(infant.firstname)}/${fmtDateGDS(infant.dob)})`;
}

// ── NM (nombre PNR del pasajero — igual en los 3 GDS) ───────
//  NM1APELLIDO/NOMBRE  ·  si es child (2-11 años cumplidos hoy): NM1APELLIDO/NOMBRE(CHD)
function ageYears(dob, refDate) {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  let refMs = Date.now();
  if (refDate) {
    const r = new Date(String(refDate).length <= 10 ? refDate + 'T00:00:00' : refDate);
    if (!isNaN(r.getTime())) refMs = r.getTime();
  }
  return Math.floor((refMs - d.getTime()) / (365.25 * 86400000));
}
function isChild(dob, refDate) {
  const y = ageYears(dob, refDate);
  return y != null && y >= 2 && y <= 11;
}
// Limpia un CUIT/CUIL: deja solo digitos (saca guiones y espacios)
function cleanCuil(c) {
  return (c || '').toString().replace(/[\s-]/g, '');
}
// refDate opcional = fecha de vuelo (para calcular CHD a esa fecha). Default: hoy.
// nameOverride opcional = {lastname, firstname} para generar el NM con otro nombre
//   (ej. pasaporte extranjero). Si se pasa, se omite el CUIT (es un ID argentino).
export function generateNM(p, refDate, nameOverride) {
  const g = getGDS();
  const apellido = stripDiacritics(nameOverride?.lastname || p.lastname || '');
  const nombre = stripDiacritics(nameOverride?.firstname || p.firstname || '');
  if (!apellido && !nombre) return '';
  const child = isChild(p.dob, refDate);
  // CUIT solo para el NM principal (sin nameOverride).
  const cuil = nameOverride ? '' : cleanCuil(p.cuil);
  // Sabre: -APELLIDO/NOMBRE  ·  child: -APELLIDO/NOMBRE*C{edad}  ·  CUIT: -APELLIDO/NOMBRE*CUIL{num}
  // (CUIT tiene precedencia sobre child: un niño con CUIT es caso raro)
  if (g === 'sabre') {
    const base = `-${apellido}/${nombre}`;
    if (cuil) return `${base}*CUIL${cuil}`;
    return child ? `${base}*C${ageYears(p.dob, refDate)}` : base;
  }
  // Amadeus / Galileo: NM1APELLIDO/NOMBRE  ·  child: NM1APELLIDO/NOMBRE(CHD)
  const base = `NM1${apellido}/${nombre}`;
  return child ? `${base}(CHD)` : base;
}

// ── FSR/CUIT (referencia CUIT/CUIL) ─────────────────────────
//  Amadeus: FSR/CUIT{num}/P{n}    (comando separado)
//  Sabre:   va en el NM como -APELLIDO/NOMBRE*CUIL{num} (sin item separado)
//  Galileo: omitido
export function generateCUIT(p) {
  const g = getGDS();
  const cuil = cleanCuil(p.cuil);
  if (!cuil) return '';
  if (g === 'amadeus') return `FSR/CUIT${cuil}/P${getPnum()}`;
  return '';
}

// ── SRDOCS para infante ─────────────────────────────────────
//  Amadeus: SRDOCSYYHK1-P-ARG-{num}-{nat}-{dob}-{MI/FI}-{exp}-{apellido}-{nombre}/P{n}
//  Sabre:   3DOCS/P/AR/{num}/{nat}/{dob}/{MI/FI}/{exp}/{apellido}/{nombre}-{pax}
//  Galileo: SI.P{n}S{seg}/DOCS*P/AR/{num}/{nat}/{dob}/{MI/FI}/{exp}/{apellido}/{nombre}/I
export function generateSRDOCSInfant(infant, pnum) {
  const g = getGDS();
  const pn = pnum || getPnum();
  const genderInfant = infant.gender === 'F' ? 'FI' : 'MI';
  const infLast = stripDiacritics(infant.lastname || '');
  const infFirst = stripDiacritics(infant.firstname || '');
  if (infant.parg?.num) {
    const nat = infant.nationality || 'ARG';
    const dob = fmtDateGDS(infant.dob);
    const exp = fmtDateGDS(infant.parg.exp);
    if (g === 'sabre') {
      return `3DOCS/P/AR/${infant.parg.num}/${nat}/${dob}/${genderInfant}/${exp}/${infLast}/${infFirst}-${pn}.1`;
    }
    if (g === 'galileo') {
      return `${galileoPrefix('DOCS', pn)}P/AR/${infant.parg.num}/${nat}/${dob}/${genderInfant}/${exp}/${infLast}/${infFirst}/I`;
    }
    return `SRDOCSYYHK1-P-ARG-${infant.parg.num}-${nat}-${dob}-${genderInfant}-${exp}-${infLast}-${infFirst}/P${pn}`;
  }
  if (g !== 'amadeus') return '';
  return `SRDOCSYYHK1-----${fmtDateGDS(infant.dob)}-${genderInfant}--${infLast}/${infFirst}/P${pn}`;
}

// ── Builder principal ───────────────────────────────────────
export function buildSSRStrings(p, pnum = '1', snum = '1', infantPassenger = null, opts = {}) {
  const prev = { ..._ctx };
  _ctx = {
    gds: opts.gds || DEFAULT_CTX.gds,
    pnum: pnum || DEFAULT_CTX.pnum,
    snum: snum || DEFAULT_CTX.snum,
    infPnum: opts.infPnum || DEFAULT_CTX.infPnum
  };
  const g = _ctx.gds;
  const items = [];

  // NM (nombre PNR) — primero, igual en los 3 GDS. refDate opcional = fecha de vuelo.
  const nm = generateNM(p, opts.refDate);
  if (nm) items.push({ label: 'NM — Nombre', value: nm });

  // NM extranjero: si el pasaporte extranjero tiene nombre y difiere del principal,
  // generar tambien el NM con ese nombre (sin CUIT). El agente copia el que corresponda.
  if (p.pext?.lastname && (p.pext.lastname !== p.lastname || p.pext.firstname !== p.firstname)) {
    const nmExt = generateNM(p, opts.refDate, { lastname: p.pext.lastname, firstname: p.pext.firstname });
    if (nmExt) items.push({ label: `NM — Nombre (pasaporte ${p.pext.country || 'extranjero'})`, value: nmExt });
  }

  // SRDOCS (pasaporte)
  if (p.parg?.num) {
    items.push({ label: g === 'amadeus' ? 'SRDOCS — Pasaporte ARG' : 'DOCS — Pasaporte ARG', value: generateSRDOCS(p, 'ARG') });
  }
  // Si hay DNI (con o sin pasaporte), el DOCS del DNI lo emite la sección DNI abajo.
  if (p.pext?.country && p.pext?.num) {
    items.push({ label: g === 'amadeus' ? `SRDOCS — Pasaporte ${p.pext.country}` : `DOCS — Pasaporte ${p.pext.country}`, value: generateSRDOCS(p, p.pext.country) });
  }
  // SRDOCS corto (solo apellido/nombre/sexo/fecha nac.) — siempre disponible (Amadeus/Sabre)
  const short = generateSRDOCSShort(p);
  if (short) items.push({ label: g === 'amadeus' ? 'SRDOCS — Corto (solo nombre)' : 'DOCS — Corto (solo nombre)', value: short });

  // DNI — DOCS tipo I (todos los GDS) + SRFOID NI (Amadeus, se mantiene).
  if (p.dni?.num) {
    const dniCountry = p.dni.country || 'ARG';
    const dniLabel = dniCountry !== 'ARG' ? `DNI ${dniCountry}` : 'DNI';
    const dniDocs = generateDNIDocs(p);
    if (dniDocs) items.push({ label: g === 'amadeus' ? `SRDOCS — ${dniLabel}` : `DOCS — ${dniLabel}`, value: dniDocs });
    if (g === 'amadeus') {
      items.push({ label: 'SRFOID — DNI', value: generateSRFOID(p, 'NI') });
    }
  }

  // FOID pasaporte — Amadeus: SRFOID PP.  Sabre: 3FOID (solo LAN).  Galileo: omitido.
  if (p.parg?.num && g !== 'galileo') {
    const foidLabel = g === 'sabre' ? 'FOID — Pasaporte (solo LAN)' : 'SRFOID — Pasaporte ARG';
    items.push({ label: foidLabel, value: generateSRFOID(p, 'PP') });
  }

  // SRDOCO (visas) — excluir type 'E' (ESTA)
  const visaList = Array.isArray(p.visas) && p.visas.length > 0
    ? p.visas
    : [p.visa1, p.visa2].filter(v => v?.country);
  visaList.filter(v => v?.type !== 'E').forEach(visa => {
    if (visa?.country) items.push({ label: g === 'amadeus' ? `SRDOCO — Visa ${visa.country}` : `DOCO — Visa ${visa.country}`, value: generateSRDOCO(p, visa) });
  });

  // Contacto — Galileo lo omite
  if (g !== 'galileo') {
    const ctce = generateSRCTCE(p);
    if (ctce) items.push({ label: g === 'amadeus' ? 'SRCTCE — Email' : 'CTCE — Email', value: ctce });
    const ctcm = generateCTCM(p);
    if (ctcm) items.push({ label: g === 'amadeus' ? 'SRCTCM — Celular' : 'CTCM — Celular', value: ctcm });
  }

  // CUIT/CUIL — Amadeus: FSR/CUIT (comando separado). Sabre: va en el NM. Galileo: omitido.
  const cuit = generateCUIT(p);
  if (cuit) items.push({ label: 'FSR — CUIT/CUIL', value: cuit });

  // Viajero Frecuente — Galileo lo omite
  if (g !== 'galileo' && Array.isArray(p.ffn)) {
    p.ffn.forEach(ffn => {
      const val = generateFFN(p, ffn);
      if (val) items.push({ label: `FFN — ${ffn.airline}`, value: val });
    });
  }

  // Infante
  if (infantPassenger) {
    const infPnum = getInfPnum();
    items.push({ label: 'NM — Infante', value: generateInfantNM(p, infantPassenger) });
    const docsInf = generateSRDOCSInfant(infantPassenger, infPnum);
    if (docsInf) items.push({ label: `SRDOCS — Infante (P${infPnum})`, value: docsInf });
  }

  _ctx = prev;
  return items;
}
