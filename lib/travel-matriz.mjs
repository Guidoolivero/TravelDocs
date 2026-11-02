// Inyeccion nationality-aware (paso 4) + fallback de URLs (paso 5).
//
// injectMatrizVisas: inyecta la tarjeta de visa segun el regimen clasificado
// de las matrices, para la nacionalidad del pasajero (Argentina incluida: las
// matrices cubren 193 destinos vs los 146 de conocidos.mjs, y hay paises como
// Kenia que solo existen en las matrices). El dedup conservador evita
// duplicados: si conocidos.mjs o el modelo ya pusieron una tarjeta de visa
// para la parada, no se inyecta nada.
//
// injectMatrizSanidad: la sanidad sale de la columna del pais de salida
// (y de las escalas anteriores), recalculada en cada entrada al pais.
//
// fillKnownUrls: completa url_oficial de tarjetas que quedaron sin link usando
// las URLs oficiales de los regionales del Excel — la red que queda cuando la
// verificacion web (Paso 2b) se salta por timeout o falla.
//
// Solo el backend (gemini-travel.cjs) importa este modulo: pesa ~240KB de datos
// y la inyeccion ocurre en la function antes de responder. La logica vive aca
// (ESM) para que node --test la cubra con js/travel-matriz.test.mjs.

import { MATRIZ_VISAS, URLS_PAISES } from './matriz.mjs';
import { nombrePais, iso3DeIso2 } from '../public/js/paises.mjs';
import { IATA_ISO2 } from './iata-iso2.mjs';

function normPais(s) {
  return (s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function reqCat(r) {
  return ((r && r.categoria) || '').toLowerCase().replace(/-/g, '_');
}

// ISO3 -> columna de la matriz. Las nacionalidades europeas mapean a la
// columna agrupada 'UE / EEE' (asi esta modelada la matriz). Reino Unido
// (post-Brexit) y el resto del mundo no tienen columna: no se inyecta.
const ISO3_A_COLUMNA = {
  ARG: 'Argentina',
  BOL: 'Bolivia', BRA: 'Brasil', CHL: 'Chile', COL: 'Colombia', ECU: 'Ecuador',
  PRY: 'Paraguay', PER: 'Peru', URY: 'Uruguay', VEN: 'Venezuela',
  MEX: 'Mexico', GTM: 'Guatemala', HND: 'Honduras', SLV: 'El Salvador',
  NIC: 'Nicaragua', CRI: 'Costa Rica', PAN: 'Panama', BLZ: 'Belice',
  USA: 'Estados Unidos', CAN: 'Canada',
  ESP: 'UE / EEE', ITA: 'UE / EEE', DEU: 'UE / EEE', FRA: 'UE / EEE',
  PRT: 'UE / EEE', NLD: 'UE / EEE', BEL: 'UE / EEE', AUT: 'UE / EEE',
  GRC: 'UE / EEE', IRL: 'UE / EEE', LUX: 'UE / EEE', SWE: 'UE / EEE',
  DNK: 'UE / EEE', FIN: 'UE / EEE', NOR: 'UE / EEE', ISL: 'UE / EEE',
  LIE: 'UE / EEE', CHE: 'UE / EEE'
};

// Extrae el ISO3 de strings como 'Brasil (BRA)', 'ARG', 'Argentina'.
function iso3DeNacionalidad(nacionalidad) {
  const m = String(nacionalidad || '').match(/\(([A-Z]{3})\)/);
  if (m) return m[1];
  const s = String(nacionalidad || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(s)) return s;
  return '';
}

function columnaDeNacionalidad(nacionalidad) {
  return ISO3_A_COLUMNA[iso3DeNacionalidad(nacionalidad)] || '';
}

// Miembros del Visa Waiver Program (los europeos que ofrece el form estan todos).
// La columna 'UE / EEE' de la matriz es agrupada y NO homogenea (ej. EEUU:
// "24 de 27 en VWP, excepcion Bulgaria/Chipre/Rumania"): para un pasaporte
// VWP el regimen real es ETA (ESTA), no "requiere visa".
const VWP_MIEMBROS = new Set([
  'ESP', 'ITA', 'DEU', 'FRA', 'PRT', 'NLD', 'BEL', 'AUT', 'GRC', 'IRL',
  'LUX', 'SWE', 'DNK', 'FIN', 'ISL', 'LIE', 'NOR', 'CHE'
]);

function matchPaisStop(stop, p) {
  const code = normPais(stop.pais_codigo);
  const nombre = normPais(stop.pais);
  const iata = (stop.aeropuerto_iata || '').toUpperCase();
  if (code && p.iso3.includes(code)) return true;
  if (iata && p.iatas.includes(iata)) return true;
  if (nombre && p.nombres.some(n => normPais(n) === nombre)) return true;
  return false;
}

// Una tarjeta de visa ya existente (la genero el modelo) bloquea la inyeccion.
function tieneReqDeVisa(stop) {
  return (stop.requisitos || []).some(r => /vis|eta|est[ao]/i.test(reqCat(r)));
}

function esFiebre(r) {
  return /fiebre amarilla|yellow fever/i.test(`${r?.nombre || ''} ${r?.descripcion || ''}`);
}

function tieneReqDeSeguro(stop) {
  return (stop.requisitos || []).some(r =>
    reqCat(r) === 'seguro_medico' || /seguro m[eé]dico/i.test(r.nombre || ''));
}

const TARJETA_POR_REGIMEN = {
  exenta:            { nombre: 'No requiere visa',              obligatorio: false },
  requiere_visa:     { nombre: 'Requiere visa de turismo',      obligatorio: true },
  evisa:             { nombre: 'e-Visa de turismo (trámite electrónico)', obligatorio: true },
  eta:               { nombre: 'Autorización electrónica de viaje (ETA)', obligatorio: true },
  visa_on_arrival:   { nombre: 'Visa a la llegada (on arrival)', obligatorio: true },
  libre_circulacion: { nombre: 'Libre circulación (UE/EEE)',    obligatorio: false }
};

function esDeclaracionEbola(texto) {
  return /declaraci[oó]n jurada|\battestation\b/i.test(texto || '');
}

function lecturaSanidad(info, entry, columna) {
  const sanidad = info && info.sanidad;
  if (!sanidad || sanidad === 'otro') return null;
  let texto = (info.texto_sanidad || '').trim();
  if (columna === 'Argentina' && texto.length < 24 && entry.sanidad_arg) {
    texto = entry.sanidad_arg.trim();
  }
  const descripcion = descripcionSanidad(sanidad, texto);
  if (sanidad === 'seguro_obligatorio') return { nombre: 'Seguro médico', texto: descripcion, nivel: sanidad };
  if (esDeclaracionEbola(descripcion)) {
    return { nombre: 'Declaración jurada (ébola)', texto: descripcion, nivel: sanidad };
  }
  const nombre = sanidad === 'sin_requisitos'
    ? 'No se exige fiebre amarilla'
    : 'Certificado internacional de fiebre amarilla';
  return { nombre, texto: descripcion, nivel: sanidad };
}

// Lectura de una celda de la matriz, sin pasar por Gemini.
export function lecturaMatriz(iso3Destino, nacionalidad) {
  const iso3 = String(iso3Destino || '').trim().toUpperCase();
  const columna = columnaDeNacionalidad(nacionalidad);
  const entry = MATRIZ_VISAS.find(p => p.iso3.includes(iso3));
  if (!entry) return { encontrado: false, columna };
  const nombre = (entry.nombres && entry.nombres[0]) || iso3;
  if (!columna) return { encontrado: true, columna: '', nombre };
  const info = entry.por_nacionalidad[columna] || {};
  let regimen = info.regimen;
  if (columna === 'UE / EEE' && regimen === 'requiere_visa'
      && VWP_MIEMBROS.has(iso3DeNacionalidad(nacionalidad)) && /\bVWP\b/i.test(info.texto || '')) {
    regimen = 'eta';
  }
  const tarjeta = TARJETA_POR_REGIMEN[regimen];
  return {
    encontrado: true,
    columna,
    nombre,
    visa: tarjeta ? { nombre: tarjeta.nombre, texto: (info.texto || '').trim() } : null,
    sinConfirmar: !tarjeta,
    sanidad: lecturaSanidad(info, entry, columna),
  };
}

export function injectMatrizVisas(data, nacionalidad = 'ARG') {
  const columna = columnaDeNacionalidad(nacionalidad);
  if (!columna) return data; // nacionalidad sin columna en la matriz

  const ruta = Array.isArray(data && data.ruta) ? data.ruta : [];
  const paradas = ruta.filter(s => s && (s.tipo === 'destino' || s.tipo === 'escala_comercial'));

  for (const stop of paradas) {
    if (tieneReqDeVisa(stop)) continue;

    const entry = MATRIZ_VISAS.find(p => matchPaisStop(stop, p));
    if (!entry) continue;

    const info = entry.por_nacionalidad[columna];
    if (!info || !info.regimen) continue;

    let regimen = info.regimen;
    // Correccion de heterogeneidad UE/EEE: pasaporte VWP + celda que habla de
    // VWP con excepciones => para ese pasaporte el regimen es ETA.
    if (columna === 'UE / EEE' && regimen === 'requiere_visa'
        && VWP_MIEMBROS.has(iso3DeNacionalidad(nacionalidad)) && /\bVWP\b/i.test(info.texto)) {
      regimen = 'eta';
    }

    const tarjeta = TARJETA_POR_REGIMEN[regimen];
    if (!tarjeta) continue; // na | sin_confirmar | desconocido: no inyectar

    const duracion = info.duracion ? ` Estadía: ${info.duracion}.` : '';
    if (!Array.isArray(stop.requisitos)) stop.requisitos = [];
    stop.requisitos.push({
      categoria: 'visado',
      nombre: tarjeta.nombre,
      obligatorio: tarjeta.obligatorio,
      descripcion: (info.texto || '').trim() || `${tarjeta.nombre} según matriz de visados verificada.`,
      costo_aproximado: '',
      anticipacion_recomendada: '',
      url_oficial: '',
      verificado_web: true,
      nota_fuentes: `Matriz de visados multinacionalidad verificada (Excel, 18-20/08/2026).${duracion}`
    });
  }
  return data;
}

function descripcionSanidad(sanidad, texto) {
  if (texto.length >= 24) return texto;
  if (sanidad === 'fiebre_amarilla_obligatoria') {
    return 'Certificado internacional de fiebre amarilla exigido para esta nacionalidad.';
  }
  if (sanidad === 'fiebre_amarilla_condicional') {
    return texto || 'Certificado de fiebre amarilla según procedencia o tránsito por zona de riesgo.';
  }
  if (sanidad === 'sin_requisitos') {
    return 'No se exige certificado de fiebre amarilla para esta nacionalidad.';
  }
  return texto || 'Seguro médico obligatorio.';
}

// Obligatorio gana a condicional, y eso gana a un "no exigido".
// Sin columna no se dice que esta exento.
const RANGO_SANIDAD = {
  sin_requisitos: 0,
  seguro_obligatorio: 1,
  fiebre_amarilla_condicional: 2,
  fiebre_amarilla_obligatoria: 3,
};

function listaY(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

export function textoSanidad(sanidad) {
  if (!sanidad) return '';
  const n = sanidad.nombre || '';
  const t = sanidad.texto || '';
  return t ? (n && !t.startsWith(n) ? `${n}. ${t}` : t) : n;
}

export function sanidadPorProcedencia(iso3Destino, salidas) {
  if (!salidas || !salidas.length) return null;
  let mejor = null;
  const sinDato = [];
  for (const iso of salidas) {
    const celda = lecturaMatriz(iso3Destino, iso);
    const nivel = celda.sanidad && celda.sanidad.nivel;
    if (!celda.columna || RANGO_SANIDAD[nivel] == null) {
      sinDato.push(nombrePais(iso));
      continue;
    }
    const rango = RANGO_SANIDAD[nivel];
    if (!mejor || rango > mejor.rango) {
      mejor = {
        rango,
        nivel,
        nombre: celda.sanidad.nombre,
        textoCelda: celda.sanidad.texto,
        textoPlano: textoSanidad(celda.sanidad),
        pais: nombrePais(iso),
      };
    }
  }
  if (sinDato.length && (!mejor || mejor.nivel === 'sin_requisitos')) {
    return { sinDato: true, texto: `La base no tiene sanidad para la salida desde ${listaY(sinDato)}.` };
  }
  return {
    sinDato: false,
    nivel: mejor.nivel,
    nombre: mejor.nombre,
    textoCelda: mejor.textoCelda,
    texto: `Sale de ${mejor.pais}. ${mejor.textoPlano}`,
  };
}

function iso3DeIata(iata) {
  const iso2 = IATA_ISO2[String(iata || '').trim().toUpperCase()];
  return iso2 ? iso3DeIso2(iso2) : '';
}

function isoDeStop(stop) {
  const code = String(stop?.pais_codigo || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code) && nombrePais(code) !== code) return code;
  const porIata = iso3DeIata(stop?.aeropuerto_iata);
  if (porIata) return porIata;
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

// Paises visitados antes de esta parada, sin el destino actual.
function paisesAntes(ruta, hasta) {
  const recorrido = [];
  for (const stop of ruta || []) {
    if (stop === hasta) break;
    const iso = isoDeStop(stop);
    if (!iso) continue;
    if (recorrido[recorrido.length - 1] !== iso) recorrido.push(iso);
  }
  const actual = isoDeStop(hasta);
  const prev = [];
  for (const iso of recorrido) {
    if (iso !== actual && !prev.includes(iso)) prev.push(iso);
  }
  return prev;
}

function asegurarOrigen(data) {
  const ruta = data && data.ruta;
  if (!Array.isArray(ruta) || ruta.some(s => s && s.tipo === 'origen')) return;
  const iata = String(data?.vuelo?.origen_iata || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) return;
  const iso = iso3DeIata(iata);
  ruta.unshift({
    tipo: 'origen',
    aeropuerto_iata: iata,
    pais_codigo: iso,
    pais: iso ? nombrePais(iso) : '',
    requisitos: []
  });
}

const NOTA_SANIDAD = 'Matriz de sanidad multinacionalidad verificada (Excel).';

function tarjetaSanidad(resultado) {
  if (resultado.sinDato) {
    return { categoria: 'vacuna', nombre: 'Fiebre amarilla', obligatorio: false, descripcion: resultado.texto };
  }
  if (resultado.nivel === 'seguro_obligatorio') {
    return { categoria: 'seguro_medico', nombre: resultado.nombre || 'Seguro médico', obligatorio: true, descripcion: resultado.texto };
  }
  if (esDeclaracionEbola(resultado.textoCelda) || esDeclaracionEbola(resultado.nombre)) {
    return {
      categoria: 'declaracion_salud',
      nombre: 'Declaración jurada (ébola)',
      obligatorio: true,
      descripcion: resultado.textoCelda || resultado.texto,
    };
  }
  const baseNo = /^\s*no\b/i.test(resultado.textoCelda || '');
  const obligatorio = resultado.nivel === 'fiebre_amarilla_obligatoria'
    || (resultado.nivel === 'fiebre_amarilla_condicional' && !baseNo);
  return { categoria: 'vacuna', nombre: resultado.nombre, obligatorio, descripcion: resultado.texto };
}

function urlSanidadDe(stop) {
  const entry = URLS_PAISES.find(p => matchPaisStop(stop, p));
  return (entry && entry.sanidad_url) || '';
}

function ponerSanidad(stop, resultado) {
  if (!Array.isArray(stop.requisitos)) stop.requisitos = [];
  stop.requisitos = stop.requisitos.filter(r => !esFiebre(r));
  const tarjeta = tarjetaSanidad(resultado);
  if (tarjeta.categoria === 'seguro_medico' && tieneReqDeSeguro(stop)) return;
  const declaracion = tarjeta.categoria === 'declaracion_salud';
  stop.requisitos.push({
    ...tarjeta,
    costo_aproximado: '',
    anticipacion_recomendada: '',
    url_oficial: declaracion ? urlSanidadDe(stop) : '',
    verificado_web: true,
    nota_fuentes: NOTA_SANIDAD,
  });
}

function diaClave(fecha) {
  const s = String(fecha || '').trim().toUpperCase();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const gds = s.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})?/);
  if (!gds) return '';
  return gds[1].padStart(2, '0') + gds[2] + (gds[3] ? gds[3].slice(-2) : '');
}

// Aeropuerto donde el tramo llega y el siguiente sale el mismo dia.
function iatasConexionMismoDia(segmentos) {
  const conexiones = new Set();
  const legs = Array.isArray(segmentos) ? segmentos : [];
  for (let i = 0; i < legs.length - 1; i++) {
    const llega = String(legs[i]?.destino || '').trim().toUpperCase();
    const sale = String(legs[i + 1]?.origen || '').trim().toUpperCase();
    if (!llega || llega !== sale) continue;
    const dia = diaClave(legs[i]?.fecha);
    if (dia && dia === diaClave(legs[i + 1]?.fecha)) conexiones.add(llega);
  }
  return conexiones;
}

// Paises que, antes de ESTA llegada, solo figuran como transito.
function transitosPurosAntes(ruta, conexiones, hasta) {
  const estadia = new Set();
  const transito = new Set();
  for (const stop of ruta || []) {
    if (stop === hasta) break;
    const iso = isoDeStop(stop);
    if (!iso) continue;
    const iata = String(stop.aeropuerto_iata || '').trim().toUpperCase();
    const pasa = stop.tipo === 'escala_comercial' || stop.tipo === 'parada_tecnica'
      || (stop.tipo !== 'origen' && conexiones.has(iata));
    if (pasa) transito.add(iso);
    else estadia.add(iso);
  }
  return new Set([...transito].filter(iso => !estadia.has(iso)));
}

const MES_IDX = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function fechaMs(fecha) {
  const s = String(fecha || '').trim().toUpperCase();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const gds = s.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})/);
  if (!gds) return NaN;
  const mes = MES_IDX[gds[2]];
  if (mes == null) return NaN;
  const anio = gds[3].length <= 2 ? 2000 + +gds[3] : +gds[3];
  return Date.UTC(anio, mes, +gds[1]);
}

// OMS/TIMATIC: muchos destinos miran los 6 dias previos. Bahamas no lo
// confirma en la fuente; no se baja el certificado, solo se avisa.
const DIAS_SIN_RIESGO = 6;

function notaEstadiaSinRiesgo(isoDestino, prev, segmentos, stop) {
  if (!Array.isArray(segmentos) || !segmentos.length) return '';
  const iata = String(stop?.aeropuerto_iata || '').trim().toUpperCase();
  if (!iata) return '';
  let idx = -1;
  for (let i = 0; i < segmentos.length; i++) {
    if (String(segmentos[i]?.destino || '').trim().toUpperCase() === iata) idx = i;
  }
  if (idx <= 0) return '';
  const sale = segmentos[idx];
  const anterior = segmentos[idx - 1];
  if (String(anterior?.destino || '').trim().toUpperCase() !== String(sale?.origen || '').trim().toUpperCase()) {
    return '';
  }
  const d1 = fechaMs(anterior.fecha);
  const d2 = fechaMs(sale.fecha);
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return '';
  const dias = Math.round((d2 - d1) / 86400000);
  if (dias < DIAS_SIN_RIESGO) return '';
  const isoStay = iso3DeIata(sale.origen);
  if (!isoStay || isoStay === isoDestino) return '';
  const celdaStay = lecturaMatriz(isoDestino, isoStay);
  if ((celdaStay.sanidad && celdaStay.sanidad.nivel) !== 'sin_requisitos') return '';
  const hayRiesgo = prev.some(iso => {
    const n = lecturaMatriz(isoDestino, iso).sanidad?.nivel;
    return n === 'fiebre_amarilla_obligatoria' || n === 'fiebre_amarilla_condicional';
  });
  if (!hayRiesgo) return '';
  return ` Si permanecio ${DIAS_SIN_RIESGO} dias o mas en ${nombrePais(isoStay)} (sin riesgo) antes de este ingreso, algunas autoridades dejan de exigir el certificado. Confirmar antes de emitir.`;
}

// '' y 'otro' no inyectan. Con procedencia, la celda es la del pais de salida.
export function injectMatrizSanidad(data, nacionalidad = 'ARG', segmentos) {
  asegurarOrigen(data);
  const columna = columnaDeNacionalidad(nacionalidad);
  const ruta = Array.isArray(data && data.ruta) ? data.ruta : [];
  const conexiones = iatasConexionMismoDia(segmentos);
  const paradas = ruta.filter(s => s && (s.tipo === 'destino' || s.tipo === 'escala_comercial'));

  for (const stop of paradas) {
    const entry = MATRIZ_VISAS.find(p => matchPaisStop(stop, p));
    if (!entry) continue;
    const isoStop = isoDeStop(stop);
    const isoDestino = entry.iso3.includes(isoStop) ? isoStop : entry.iso3[0];
    let prev = paisesAntes(ruta, stop);
    // Aruba exime el transito por aeropuerto o puerto de un pais de riesgo
    // (airportaruba.com/yellow-fever-vaccine, excepcion 2). No hay horas en
    // el itinerario: cuenta una escala, una parada tecnica, o el aeropuerto
    // donde se llega y se sale el mismo dia.
    // ponytail: mismo dia, no horas. Una escala que cruza la medianoche no entra.
    if (isoDestino === 'ABW' && prev.length) {
      const puros = transitosPurosAntes(ruta, conexiones, stop);
      const queda = prev.filter(iso => !puros.has(iso));
      if (queda.length) prev = queda;
    }
    const porSalida = sanidadPorProcedencia(isoDestino, prev);
    if (porSalida) {
      if (!porSalida.sinDato && porSalida.nivel !== 'sin_requisitos') {
        porSalida.texto += notaEstadiaSinRiesgo(isoDestino, prev, segmentos, stop);
      }
      ponerSanidad(stop, porSalida);
      continue;
    }
    if (!columna) continue;

    const info = entry.por_nacionalidad[columna];
    const sanidad = info && info.sanidad;
    if (!sanidad || sanidad === 'otro') continue;

    let texto = (info.texto_sanidad || '').trim();
    if (columna === 'Argentina' && texto.length < 24 && entry.sanidad_arg) {
      texto = entry.sanidad_arg.trim();
    }
    const descripcion = descripcionSanidad(sanidad, texto);
    const nombre = sanidad === 'seguro_obligatorio'
      ? 'Seguro médico'
      : (sanidad === 'sin_requisitos'
        ? 'No se exige fiebre amarilla'
        : 'Certificado internacional de fiebre amarilla');
    ponerSanidad(stop, { sinDato: false, nivel: sanidad, nombre, textoCelda: texto, texto: descripcion });
  }
  return data;
}

// Paso 5: completa URLs faltantes desde los regionales del Excel.
export function fillKnownUrls(data) {
  const ruta = Array.isArray(data && data.ruta) ? data.ruta : [];
  const paradas = ruta.filter(s => s && (s.tipo === 'destino' || s.tipo === 'escala_comercial'));

  for (const stop of paradas) {
    const entry = URLS_PAISES.find(p => matchPaisStop(stop, p));
    if (!entry) continue;

    for (const r of (stop.requisitos || [])) {
      if (r.url_oficial) continue;
      const cat = reqCat(r);
      const url = /vis|eta|est[ao]/i.test(cat) ? entry.visa_url : entry.sanidad_url;
      if (url) {
        r.url_oficial = url;
        if (!r.nota_fuentes) r.nota_fuentes = 'URL oficial de la base verificada (Excel).';
      }
    }
  }
  return data;
}
