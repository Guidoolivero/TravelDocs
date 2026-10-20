// Decisiones de vista + unificacion de formularios conocidos (Aruba/Jamaica).

const HEALTH_CATS = new Set(['vacuna', 'medicacion', 'seguro_medico', 'declaracion_salud']);

function reqCat(r) {
  return ((r && r.categoria) || '').toLowerCase().replace(/-/g, '_');
}

function normPais(s) {
  return (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Tabla de paises con formularios/requisitos conocidos (extraidos del Excel verificado).
// El matcher identifica el pais por ISO3 / IATA / nombre; sameAs reemplaza la
// variante que arma el modelo (o la agrega si la omite).
// Fuente unica: docs/conocidos.json -> js/conocidos.mjs (generado por
// scripts/gen-conocidos.mjs). Antes este array estaba duplicado aca y en
// gemini-travel.cjs: ahora ambos importan el mismo modulo.
import { PAISES_CONOCIDOS, ALERTAS_CONOCIDAS } from './conocidos.mjs';

function matchPaisStop(stop, p) {
  const code = normPais(stop.pais_codigo);
  const nombre = normPais(stop.pais);
  const iata = (stop.aeropuerto_iata || '').toUpperCase();
  if (code && p.iso3.includes(code)) return true;
  if (nombre && p.nombres.includes(nombre)) return true;
  if (iata && p.iatas.includes(iata)) return true;
  return false;
}

function sameAsReq(req, r) {
  const re = req.sameAs;
  if (!re) return false;
  return re.test((r && r.nombre) || '') || re.test((r && r.url_oficial) || '');
}

function esCorrectorFiebre(req) {
  const src = req?.sameAs instanceof RegExp ? req.sameAs.source : '';
  return /fiebre amarilla|yellow fever/i.test(src);
}

function tieneSanidadMatriz(stop) {
  return (stop.requisitos || []).some(r => /Matriz de sanidad/i.test((r && r.nota_fuentes) || ''));
}

function normReqUrl(u) {
  return (u || '').toString().trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .split('?')[0]
    .split('#')[0];
}

const SKIP_TOKENS = new Set(['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'O', 'THE', 'AND', 'OF', 'UN', 'UNA', 'PARA', 'POR']);

function nameKey(s) {
  const tokens = normPais(s)
    .replace(/ETICKET/g, 'E TICKET')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 2 && !SKIP_TOKENS.has(w))
    .sort();
  return tokens.length >= 3 ? tokens.join(' ') : '';
}

function reqScore(r) {
  if (!r) return 0;
  const filled = ['descripcion', 'costo_aproximado', 'anticipacion_recomendada', 'url_oficial']
    .filter(k => r[k]).length;
  return filled * 10 + ((r.descripcion || '').length);
}

function pickRicherReq(a, b) {
  const [primary, other] = reqScore(b) > reqScore(a) ? [b, a] : [a, b];
  const out = { ...primary };
  for (const k of ['descripcion', 'costo_aproximado', 'anticipacion_recomendada', 'url_oficial', 'categoria', 'nombre']) {
    if (!out[k] && other[k]) out[k] = other[k];
  }
  if (primary.obligatorio || other.obligatorio) out.obligatorio = true;
  return out;
}

// True si un nombre es una visa Schengen de corta estancia (Tipo C / uniforme):
// el modelo y la verificacion web la redactan distinto ("Visa Schengen" vs
// "Visa de corta estancia Tipo C"), lo que dejaba dos tarjetas duplicadas del
// mismo tramite. Normaliza igual que normReq del backend (mayus, sin acentos,
// solo alfanum + espacios) reusando normPais: el regex va SIN acentos porque ya
// los saco. Excluye transito (Tipo A/B), larga duracion y residencia, que son
// tramites distintos aunque compartan la palabra "visa".
const VISA_SCHENGEN_INCLUDE = /\bschengen\b|corta\s+(estancia|estadia|duracion)|breve\s+(estancia|estadia|duracion)|tipo\s+c\b|categoria\s+c\b|visa\s+c\b|uniforme/i;
const VISA_SCHENGEN_EXCLUDE = /\btransito\b|\btransit\b|airport|aeroportu|tipo\s+a\b|tipo\s+b\b|tipo\s+d\b|categoria\s+(a|b|d)\b|\bnacional\b|\blarga\b|\blargo\b|\bresidencia\b|long\s+stay|\blonga\b|\blongo\b|\bpermanente\b/i;
export function isSchengenVisa(name) {
  const n = normPais(name).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return VISA_SCHENGEN_INCLUDE.test(n) && !VISA_SCHENGEN_EXCLUDE.test(n);
}
// Misma visa Schengen de corta estancia. Conservativo: ante la duda devuelve false
// (dos tarjetas duplicadas es un menor mal que una tarjeta silenciosamente
// sobreescrita con la URL/costo de otra visa distinta).
export function sameVisa(a, b) {
  return isSchengenVisa(a) && isSchengenVisa(b);
}

// Une tarjetas del mismo tramite: misma URL oficial, el mismo set de palabras
// (orden distinto) o la misma visa Schengen de corta estancia (nombre distinto).
export function dedupeTravelReqs(requisitos) {
  const list = Array.isArray(requisitos) ? requisitos : [];
  const out = [];
  const byUrl = new Map();
  const byName = new Map();
  const byVisa = new Map();
  for (const r of list) {
    if (!r) continue;
    const url = normReqUrl(r.url_oficial);
    const key = nameKey(r.nombre);
    const visa = isSchengenVisa(r.nombre) ? '__schengen_c__' : null;
    let idx = url ? byUrl.get(url) : undefined;
    if (idx === undefined && key) idx = byName.get(key);
    if (idx === undefined && visa) idx = byVisa.get(visa);
    if (idx === undefined) {
      idx = out.length;
      out.push(r);
    } else {
      out[idx] = pickRicherReq(out[idx], r);
    }
    if (url) byUrl.set(url, idx);
    if (key) byName.set(key, idx);
    if (visa) byVisa.set(visa, idx);
  }
  return out;
}

export function splitTravelReqs(requisitos) {
  const list = Array.isArray(requisitos) ? requisitos : [];
  return {
    migratorios: list.filter(r => !HEALTH_CATS.has(reqCat(r))),
    salud: list.filter(r => HEALTH_CATS.has(reqCat(r)))
  };
}

// Reemplaza variantes duplicadas (mismo formulario/tasa/link) por UNA tarjeta canonica.
// Si Gemini omitio el formulario, lo agrega.
export function injectKnownForms(data, nacionalidad = 'ARG') {
  // Guard por requisito (fix fino): los reqs marcados solo_arg:false son universales
  // (aplican a toda nacionalidad, ej ED Card, C5, e-Ticket, Air Suvidha). El resto
  // es argentino-especifico (default solo_arg:true) y solo se inyecta para argentinos,
  // para no sobrescribir el output de Gemini (que es nationality-aware).
  const isArg = /\bARG\b|ARGENTIN[AO]/i.test(nacionalidad);
  const ruta = Array.isArray(data && data.ruta) ? data.ruta : [];
  // ETIAS no esta vigente (ago 2026): no es requisito para ninguna nacionalidad.
  // Se saca antes del loop de correctores. El corrector argentino lo tapaba con
  // "Argentina exenta"; los no-argentinos quedaban expuestos a la alucinacion.
  for (const stop of ruta) {
    if (!stop) continue;
    if (Array.isArray(stop.requisitos)) {
      stop.requisitos = stop.requisitos.filter(r => !/\betias\b|sistema europeo de informaci[oó]n y autorizaci[oó]n/i.test((r && r.nombre) || ''));
    }
  }
  for (const stop of ruta) {
    if (!stop) continue;
    if (stop.tipo === 'origen' || stop.tipo === 'parada_tecnica') continue;
    if (!Array.isArray(stop.requisitos)) stop.requisitos = [];
    for (const p of PAISES_CONOCIDOS) {
      if (!matchPaisStop(stop, p)) continue;
      for (const req of p.reqs) {
        if (!isArg && req.solo_arg !== false) continue;
        if (esCorrectorFiebre(req) && tieneSanidadMatriz(stop)) continue;
        stop.requisitos = stop.requisitos.filter(r => !sameAsReq(req, r));
        stop.requisitos.push({
          ...req,
          verificado_web: true,
          nota_fuentes: req.nota_fuentes || 'Formulario oficial conocido (unificado).'
        });
      }
    }
    stop.requisitos = dedupeTravelReqs(stop.requisitos);
  }
  return data;
}

// Alertas criticas conocidas: advertencias generales (sin URL/precio) que el modelo
// no conoce o omite y se inyectan deterministicamente. Van al array flight-level
// data.alertas_criticas (panel ALERTAS CRITICAS en la UI). Distinto de
// PAISES_CONOCIDOS: esas son tarjetas de requisito accionables con url_oficial/costo.

export function injectKnownAlerts(data, nacionalidad = 'ARG') {
  const isArg = /\bARG\b|ARGENTIN[AO]/i.test(nacionalidad);
  const ruta = Array.isArray(data && data.ruta) ? data.ruta : [];
  const paradas = ruta.filter(s => s && (s.tipo === 'destino' || s.tipo === 'escala_comercial'));
  if (!Array.isArray(data.alertas_criticas)) data.alertas_criticas = [];
  for (const a of ALERTAS_CONOCIDAS) {
    if (a.solo_arg && !isArg) continue;
    if (!paradas.some(stop => matchPaisStop(stop, a))) continue;
    if (data.alertas_criticas.some(x => a.dedup.test(String(x)))) continue; // no duplicar
    data.alertas_criticas.push(a.texto);
  }
  return data;
}

// Ruta sin paradas verificadas por la búsqueda del Paso 1 (texto sin
// "PARADAS: VERIFICADAS" o búsqueda caída): forzar confianza baja + alerta al
// agente. Evita presentar como vuelo directo uno con paradas sin confirmar.
export function flagUnverifiedRoute(data) {
  if (!data || typeof data !== 'object') return data;
  if (data.vuelo && typeof data.vuelo === 'object') data.vuelo.confianza_ruta = 'baja';
  if (!Array.isArray(data.alertas_criticas)) data.alertas_criticas = [];
  const yaEsta = data.alertas_criticas.some(a => /no se pudo verificar.*paradas?/i.test(String(a)));
  if (!yaEsta) {
    data.alertas_criticas.push(
      'No se pudo verificar si este vuelo tiene paradas técnicas o escalas intermedias. ' +
      'Confirmar con la aerolínea antes de emitir.'
    );
  }
  return data;
}


function isoNacionalidad(nacionalidad) {
  const s = String(nacionalidad || 'ARG').toUpperCase();
  const paren = s.match(/\(([A-Z]{3})\)/);
  if (paren) return paren[1];
  return s.replace(/[^A-Z]/g, '').slice(0, 3) || 'ARG';
}

const TIPO_RANGO = { destino: 3, escala_comercial: 2, parada_tecnica: 1, origen: 0 };

function clavePais(stop) {
  const iso = String(stop?.pais_codigo || '').toUpperCase();
  if (iso) return iso;
  const iata = String(stop?.aeropuerto_iata || '').toUpperCase();
  return iata ? 'iata:' + iata : '';
}

function seedParada(stop) {
  const iata = String(stop.aeropuerto_iata || '').toUpperCase();
  const ciudad = String(stop.ciudad || '').trim();
  return {
    ...stop,
    aeropuertos: iata ? [iata] : [],
    ciudades: iata ? [ciudad] : (ciudad ? [ciudad] : []),
    requisitos: Array.isArray(stop.requisitos) ? stop.requisitos.slice() : [],
  };
}

function sumarParada(into, stop) {
  const iata = String(stop.aeropuerto_iata || '').toUpperCase();
  const ciudad = String(stop.ciudad || '').trim();
  if (iata) {
    const idx = into.aeropuertos.indexOf(iata);
    if (idx < 0) {
      into.aeropuertos.push(iata);
      into.ciudades.push(ciudad);
    } else if (ciudad && !into.ciudades[idx]) {
      into.ciudades[idx] = ciudad;
    }
  } else if (ciudad && !into.ciudades.includes(ciudad)) {
    into.ciudades.push(ciudad);
  }
  if (!into.pais && stop.pais) into.pais = stop.pais;
  if (!into.pais_codigo && stop.pais_codigo) into.pais_codigo = stop.pais_codigo;
  if (stop.alerta) into.alerta = true;
  if (stop.libre_ingreso) into.libre_ingreso = true;
  if (stop.notas) into.notas = into.notas ? into.notas + ' ' + stop.notas : stop.notas;
  const rangoNuevo = TIPO_RANGO[stop.tipo] || 0;
  const rangoOld = TIPO_RANGO[into.tipo] || 0;
  if (rangoNuevo > rangoOld) into.tipo = stop.tipo;
  if (Array.isArray(stop.requisitos) && stop.requisitos.length) {
    into.requisitos = into.requisitos.concat(stop.requisitos);
  }
}

// Requisitos por pais, no por ciudad. El origen vacio no se muestra si hay
// destino. La vuelta a casa del pasajero de ese pais tampoco. Cabotaje
// interno: solo la llegada. Reentrada al mismo pais: se unen requisitos.
export function paradasVisibles(ruta, nacionalidad = 'ARG') {
  const stops = Array.isArray(ruta) ? ruta : [];
  const nac = isoNacionalidad(nacionalidad);
  const origenIso = String(stops[0]?.pais_codigo || '').toUpperCase();
  const hayOtroPais = stops.some(s => {
    const iso = String(s?.pais_codigo || '').toUpperCase();
    return iso && iso !== origenIso;
  });
  const hayDestino = stops.some(s => s && s.tipo && s.tipo !== 'origen');
  const grupos = [];
  const porClave = new Map();

  stops.forEach((stop, i) => {
    if (!stop) return;
    if (stop.tipo === 'origen' && hayDestino) return;
    const iso = String(stop.pais_codigo || '').toUpperCase();
    const esUltimo = i === stops.length - 1;
    if (esUltimo && origenIso && iso === origenIso && nac === origenIso && hayOtroPais) return;
    const clave = clavePais(stop);
    if (!clave) {
      grupos.push(seedParada(stop));
      return;
    }
    const ya = porClave.get(clave);
    if (!ya) {
      const g = seedParada(stop);
      porClave.set(clave, g);
      grupos.push(g);
    } else {
      sumarParada(ya, stop);
    }
  });

  for (const g of grupos) {
    g.requisitos = dedupeTravelReqs(g.requisitos);
    g.aeropuerto_iata = g.aeropuertos[0] || g.aeropuerto_iata || '';
    if (g.ciudades[0] && !g.ciudad) g.ciudad = g.ciudades[0];
  }
  return grupos;
}

export function planTravelStopView(stop) {
  const requisitos = dedupeTravelReqs(Array.isArray(stop && stop.requisitos) ? stop.requisitos : []);
  const { migratorios, salud } = splitTravelReqs(requisitos);
  const libre = !!(stop && stop.libre_ingreso);
  return {
    migratorios,
    salud,
    showLibreBanner: libre,
    showMigratorioCards: migratorios.length > 0,
    showEmptyState: requisitos.length === 0 && !libre,
    showHealthSection: requisitos.length > 0
  };
}
