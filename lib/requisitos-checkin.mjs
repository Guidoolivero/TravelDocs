// Mail de requisitos al crear un check-in. Lee la matriz de los Excel
// (viaje-matriz) y no llama a Gemini.

import { requisitosAlertDue, marcoEmail } from '../public/js/alert-core.mjs';
import { evaluarExposicion, lecturaMatriz, sanidadPorProcedencia, textoSanidad } from './travel-matriz.mjs';
import { MATRIZ_VISAS } from './matriz.mjs';
import { nombrePais, iso3DeIso2 } from '../public/js/paises.mjs';
import { IATA_ISO2 } from './iata-iso2.mjs';
import { alcanzaConDni, esArgentino, esCabotaje } from '../public/js/cabotaje.mjs';
import { PAISES_CONOCIDOS } from '../public/js/conocidos.mjs';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function emailAviso(alertEmail, agencyEmail) {
  const propio = String(alertEmail || '').trim();
  return propio || String(agencyEmail || '').trim();
}

function primeraFecha(reserva) {
  const fechas = (reserva?.piernas || []).map(p => p && p.fecha).filter(Boolean).slice().sort();
  return fechas[0];
}

function epochDe(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (valor instanceof Date) {
    const n = valor.getTime();
    return Number.isFinite(n) ? n : null;
  }
  if (valor && typeof valor.toMillis === 'function') {
    const n = valor.toMillis();
    return Number.isFinite(n) ? n : null;
  }
  if (valor && typeof valor.seconds === 'number') return valor.seconds * 1000;
  return null;
}

// El alta fue más de 30 días antes del vuelo: el mail de los 30 días
// todavía tiene que salir. Sin createdAt no se puede saber, y no se duplica.
function altaFueAntesDeLaVentana(reserva) {
  const creado = epochDe(reserva?.createdAt);
  if (creado == null) return false;
  return !requisitosAlertDue(primeraFecha(reserva), creado);
}

// alCrear: el alta avisa siempre, salvo cabotaje con todos argentinos.
// El cron avisa al entrar en los 30 días. Si el alta ya avisó adentro de
// esa ventana, no sale otro. Si avisó antes, el de los 30 días sale igual.
export function debeEnviarRequisitos(reserva, { alCrear = false, now = Date.now(), pasajeros = [] } = {}) {
  if (!reserva?.pendingPassengers?.length && alcanzaConDni(reserva?.piernas, pasajeros)) return false;
  if (alCrear) return !reserva?.reqsNotified;
  if (reserva?.reqs30Notified) return false;
  if (reserva?.reqsNotified && !altaFueAntesDeLaVentana(reserva)) return false;
  return requisitosAlertDue(primeraFecha(reserva), now);
}

// Qué marca dejar después de un envío que salió bien.
export function marcasTrasEnvioRequisitos(reserva, { alCrear = false, now = Date.now() } = {}) {
  if (!alCrear) return { reqs30Notified: true };
  if (requisitosAlertDue(primeraFecha(reserva), now)) {
    return { reqsNotified: true, reqs30Notified: true };
  }
  return { reqsNotified: true };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtFecha(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return String(s || '');
  const hora = m[4] ? `, ${m[4]}:${m[5]}` : '';
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}${hora}`;
}

function nombrePasajero(p) {
  return `${p?.lastname || ''}, ${p?.firstname || ''}`.replace(/^, |, $/g, '') || 'Pasajero';
}

function pasaportesDe(p) {
  const out = [];
  if (p?.parg?.num) out.push({ codigo: 'ARG', etiqueta: 'Pasaporte argentino' });
  const ext = String(p?.pext?.country || '').trim().toUpperCase();
  if (ext && p?.pext?.num) out.push({ codigo: ext, etiqueta: 'Pasaporte de ' + nombrePais(ext) });
  return out;
}

function iso3DeIata(iata) {
  const iso2 = IATA_ISO2[iata];
  return iso2 ? iso3DeIso2(iso2) : '';
}

function iataDe(raw) {
  const iata = String(raw || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(iata) ? iata : '';
}

function anotar(porPais, desconocidos, ya, iata, soloSiExiste) {
  const iso3 = iso3DeIata(iata);
  if (!iso3) {
    if (!ya.has(iata)) { ya.add(iata); desconocidos.push(iata); }
    return;
  }
  if (soloSiExiste && !porPais.has(iso3)) return;
  if (!porPais.has(iso3)) porPais.set(iso3, { iso3, nombre: nombrePais(iso3), iatas: [] });
  const d = porPais.get(iso3);
  if (!d.iatas.includes(iata)) d.iatas.push(iata);
}

// Destino y escalas entran siempre. El origen se suma si ese país ya es
// destino (MAD junto a BCN). El origen del viaje no se vuelve un destino.
function destinosDe(piernas) {
  const porPais = new Map();
  const desconocidos = [];
  const ya = new Set();
  const legs = piernas || [];
  for (const pierna of legs) {
    for (const raw of [pierna?.destino, ...(pierna?.escalas || [])]) {
      const iata = iataDe(raw);
      if (iata) anotar(porPais, desconocidos, ya, iata, false);
    }
  }
  for (const pierna of legs) {
    const iata = iataDe(pierna?.origen);
    if (iata) anotar(porPais, desconocidos, ya, iata, true);
  }
  return { destinos: [...porPais.values()], desconocidos };
}

const AVISO_30 = 'Este recordatorio te llega por haber cargado el check-in en TravelDocs, volverás a recibirlo 30 días antes de la salida. Ser profesional tiene sus privilegios.';

const P = 'margin:0;font-size:14px;line-height:1.5;color:#111827;font-family:Arial,Helvetica,sans-serif;';

function lineaVisa(nombre, texto) {
  const t = (texto || '').trim();
  if (!t) return nombre;
  if (t.toLowerCase().startsWith(nombre.toLowerCase())) return t;
  return `${nombre}. ${t}`;
}

const INGRESO_DOM = 'Formulario electrónico de entrada y salida (E-Ticket de Migración). Obligatorio para ingresar y salir. Gratis. https://eticket.migracion.gob.do/';

// Tarjetas de ingreso (ED Card, NZeTA, TDAC, etc.) de docs/conocidos.json.
// La visa y la fiebre amarilla ya salen de la matriz. solo_arg distinto de
// false es el texto argentino: no se le pone a un pasaporte que no lo es.
const FORMULARIOS = new Map();
for (const p of PAISES_CONOCIDOS) {
  for (const iso of p.iso3 || []) {
    const code = String(iso).toUpperCase();
    if (code.length !== 3) continue;
    // China figura dos veces: la ficha vacia no puede pisar la tarjeta.
    const prev = FORMULARIOS.get(code);
    FORMULARIOS.set(code, prev ? prev.concat(p.reqs || []) : (p.reqs || []));
  }
}

function costoIngreso(req) {
  const c = String(req.costo_aproximado || '').trim();
  if (!c || /consultar/i.test(c)) return '';
  if (/^gratuito\b/i.test(c)) return c.replace(/^gratuito/i, 'Gratis');
  return c;
}

function lineaIngreso(req) {
  if (req.url_oficial === 'https://eticket.migracion.gob.do/') return INGRESO_DOM;
  const bits = [req.nombre];
  if (req.obligatorio) bits.push('Obligatorio');
  const costo = costoIngreso(req);
  if (costo) bits.push(costo);
  let linea = bits.join('. ');
  if (req.url_oficial) linea += '. ' + req.url_oficial;
  return linea;
}

function ingresosDe(iso3, codigos) {
  const soloArgentinos = codigos.length > 0 && codigos.every(c => c === 'ARG');
  const out = [];
  for (const r of FORMULARIOS.get(iso3) || []) {
    if (r.categoria !== 'PLF') continue;
    if (r.solo_arg !== false && !soloArgentinos) continue;
    const linea = lineaIngreso(r);
    if (linea) out.push(linea);
  }
  return out;
}

function puntosDe(pierna) {
  const out = [];
  const origen = iataDe(pierna?.origen);
  if (origen) out.push({ iata: origen, llega: false });
  for (const raw of pierna?.escalas || []) {
    const iata = iataDe(raw);
    if (iata) out.push({ iata, llega: true });
  }
  const destino = iataDe(pierna?.destino);
  if (destino) out.push({ iata: destino, llega: true });
  return out;
}

// Cada entrada al pais: se unen los paises de antes (la sanidad mas estricta gana).
function salidasPorDestino(piernas) {
  const llegada = new Map();
  const recorrido = [];
  for (const pierna of piernas || []) {
    for (const punto of puntosDe(pierna)) {
      const iso = iso3DeIata(punto.iata);
      if (!iso) continue;
      if (punto.llega) {
        const ya = llegada.get(iso) || [];
        for (const p of recorrido) {
          if (p !== iso && !ya.includes(p)) ya.push(p);
        }
        llegada.set(iso, ya);
      }
      if (recorrido[recorrido.length - 1] !== iso) recorrido.push(iso);
    }
  }
  return llegada;
}

const NO_PIDE_VACUNAS = new Set(
  MATRIZ_VISAS
    .filter(e => {
      const cols = Object.values(e.por_nacionalidad || {});
      return cols.length > 0 && cols.every(c => c.sanidad === 'sin_requisitos');
    })
    .flatMap(e => e.iso3)
);

function lecturaDe(iso3, codigo, exposicion) {
  const salidas = Array.isArray(exposicion) ? exposicion : (exposicion?.salidas || []);
  const celda = lecturaMatriz(iso3, codigo);
  if (!celda.encontrado) return null;
  let visa;
  if (!celda.columna) visa = 'La base no tiene datos de este pasaporte (' + nombrePais(codigo) + ').';
  else if (celda.visa) visa = lineaVisa(celda.visa.nombre, celda.visa.texto);
  else if (celda.sinConfirmar) visa = 'La base no confirma el visado para este pasaporte.';
  else visa = 'La base no tiene datos de este pasaporte.';
  let sanidad = NO_PIDE_VACUNAS.has(iso3) ? 'No hay vacunas obligatorias.' : textoSanidad(celda.sanidad);
  const r = sanidadPorProcedencia(iso3, salidas);
  if (r && !r.sinDato) {
    sanidad = NO_PIDE_VACUNAS.has(iso3) ? r.texto.replace(/\. .*$/, '. No hay vacunas obligatorias.') : r.texto;
  } else if (r && r.sinDato && !NO_PIDE_VACUNAS.has(iso3)) {
    sanidad = r.texto;
  }
  if (exposicion && exposicion.nota) sanidad = `${sanidad} ${exposicion.nota}`.trim();
  return { visa, sanidad };
}

// Escalas de la pierna son transito aereo. Un pais que ya es origen o destino
// de una pierna anterior es estadia, aunque tambien figure como escala.
function diaDe(fecha) {
  return String(fecha || '').slice(0, 10);
}

function exposicionDePiernas(piernas) {
  const base = salidasPorDestino(piernas);
  const out = new Map();
  const legs = piernas || [];
  for (const [isoDestino, prev] of base) {
    const estadia = new Set();
    const transitos = [];
    let llegaDeConexion = '';
    for (let i = 0; i < legs.length; i++) {
      const p = legs[i];
      const origenIata = iataDe(p?.origen);
      const origen = iso3DeIata(origenIata);
      const destinoIata = iataDe(p?.destino);
      const destino = iso3DeIata(destinoIata);
      if (origen && origenIata !== llegaDeConexion) estadia.add(origen);
      const info = new Map((p?.transitos || []).map(t => [String(t?.iata || '').trim().toUpperCase(), t]));
      for (const raw of p?.escalas || []) {
        const iata = iataDe(raw);
        const iso = iso3DeIata(iata);
        if (!iso) continue;
        const t = info.get(iata) || {};
        const minutos = Number.isFinite(t.minutos) ? t.minutos : null;
        transitos.push({
          iso,
          iata,
          minutos,
          sinHora: minutos == null || !!t.sinHora,
        });
      }
      const next = legs[i + 1];
      const sigue = next && destinoIata && destinoIata === iataDe(next.origen);
      const mismoDia = sigue && diaDe(p?.fecha) && diaDe(p.fecha) === diaDe(next.fecha);
      if (destino === isoDestino) break;
      if (destino && mismoDia) {
        transitos.push({ iso: destino, iata: destinoIata, minutos: null, sinHora: true });
        llegaDeConexion = destinoIata;
      } else if (destino) {
        estadia.add(destino);
        llegaDeConexion = '';
      }
    }
    out.set(isoDestino, evaluarExposicion(isoDestino, prev, {
      estadia,
      transitos: transitos.filter(t => !estadia.has(t.iso)),
    }));
  }
  return out;
}

function trato(p) {
  return p?.gender === 'F' ? 'Pasajera' : 'Pasajero';
}

function listaY(items) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function tituloPasaporte(etiqueta, holders, total) {
  if (holders.length === total) {
    if (total === 2) return `${etiqueta}. Lo tienen los dos.`;
    if (total > 2) return `${etiqueta}. Lo tienen todos.`;
    return etiqueta;
  }
  const quienes = holders.map(p => `${p?.gender === 'F' ? 'la pasajera' : 'el pasajero'} ${p?.lastname || p?.firstname || ''}`.trim());
  return `${etiqueta}. Solo ${listaY(quienes)}.`;
}

function armarBloques(destinos, quienes, salidas) {
  const bloques = [];
  for (const d of destinos) {
    const lineas = [];
    const vistos = new Set();
    const desde = salidas.get(d.iso3) || [];
    for (const pax of quienes) {
      for (const pass of pasaportesDe(pax)) {
        if (vistos.has(pass.codigo)) continue;
        vistos.add(pass.codigo);
        const lec = lecturaDe(d.iso3, pass.codigo, desde);
        if (!lec) continue;
        const holders = quienes.filter(p => pasaportesDe(p).some(x => x.codigo === pass.codigo));
        lineas.push({ ...lec, titulo: tituloPasaporte(pass.etiqueta, holders, quienes.length) });
      }
    }
    if (lineas.length) {
      bloques.push({ ...d, lineas, ingresos: ingresosDe(d.iso3, [...vistos]) });
    } else if (d.iso3 !== 'ARG' && !MATRIZ_VISAS.some(e => e.iso3.includes(d.iso3))) {
      bloques.push({
        ...d,
        lineas: [{ titulo: 'Visado y sanidad', visa: 'No tenemos datos de este destino en la base. Verificá los requisitos antes de emitir.', sanidad: '' }],
        ingresos: ingresosDe(d.iso3, [...vistos]),
      });
    }
  }
  return bloques;
}

function agrupar(bloques) {
  const grupos = [];
  const por = new Map();
  for (const b of bloques) {
    const firma = b.lineas.map(l => `${l.titulo}\n${l.visa}\n${l.sanidad}`).join('\n')
      + '\n' + (b.ingresos || []).join('\n');
    const ya = por.get(firma);
    if (ya) ya.paises.push(b);
    else {
      const g = { paises: [b], lineas: b.lineas, ingresos: b.ingresos || [] };
      por.set(firma, g);
      grupos.push(g);
    }
  }
  return grupos;
}

function tituloDestinos(paises) {
  const palabra = paises.length === 1 ? 'Destino' : 'Destinos';
  const nombres = paises.map(p => `${p.nombre} (${p.iatas.join(', ')})`);
  return `${palabra} ${listaY(nombres)}`;
}

function pVuelo(p, primero) {
  const ruta = [p.origen, p.destino].filter(Boolean).map(c => esc(String(c).toUpperCase())).join(' &rarr; ');
  const resto = [ruta, esc(fmtFecha(p.fecha)), p.reservaVuelo ? 'Reserva ' + esc(p.reservaVuelo) : ''].filter(Boolean).join(' &middot; ');
  const vuelo = p.vuelo ? `<span style="font-family:Georgia,'Times New Roman',serif;font-size:16px;">${esc(p.vuelo)}</span> &middot; ` : '';
  const borde = primero ? 'border-top:1px solid #111827;' : '';
  return `<p style="${P}padding:14px 0;${borde}border-bottom:1px solid #d4cdc4;line-height:1.4;font-weight:bold;">${vuelo}${resto}</p>`;
}

function pTexto(texto, extra) {
  return `<p style="${P}${extra || ''}">${esc(texto)}</p>`;
}

function htmlGrupo(g) {
  const textos = [...new Set(g.lineas.map(l => l.sanidad).filter(Boolean))];
  const aparte = textos.length === 1;
  const filas = g.lineas.map((l, i) => {
    const visa = !aparte && l.sanidad ? `${l.visa} ${l.sanidad}` : l.visa;
    const borde = i === 0 ? 'border-top:1px solid #111827;' : '';
    return `<p style="${P}padding:14px 0 4px;${borde}font-weight:bold;">${esc(l.titulo)}</p>
<p style="${P}padding:0 0 14px;border-bottom:1px solid #d4cdc4;">${esc(visa)}</p>`;
  });
  if (g.ingresos.length) {
    filas.push(`<p style="${P}padding:14px 0 4px;font-weight:bold;">Ingreso</p>`);
    for (const linea of g.ingresos) {
      filas.push(`<p style="${P}padding:0 0 14px;border-bottom:1px solid #d4cdc4;">${esc(linea)}</p>`);
    }
  }
  if (aparte) {
    const titulo = g.lineas.length === 2
      ? 'Sanidad. Igual para los dos pasaportes.'
      : (g.lineas.length > 2 ? 'Sanidad. Igual para todos los pasaportes.' : 'Sanidad');
    filas.push(`<p style="${P}padding:14px 0 4px;font-weight:bold;">${titulo}</p>`);
    filas.push(`<p style="${P}padding:0 0 14px;border-bottom:1px solid #d4cdc4;">${esc(textos[0])}</p>`);
  }
  return `<tr><td style="padding-top:44px;">
<p style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:bold;color:#111827;letter-spacing:-0.5px;">${esc(tituloDestinos(g.paises))}</p>
${filas.join('\n')}
</td></tr>`;
}

function avisoLegal() {
  return `<tr><td style="padding-top:44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td class="td-td" style="padding:16px 18px;border:1px solid #6b6256;">
<p class="td-sub" style="margin:0 0 10px;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#6b6256;font-family:Arial,Helvetica,sans-serif;">Aviso legal</p>
<p class="td-td" style="${P}margin:0 0 8px;">⚠ Datos orientativos — verificar antes de emitir.</p>
<p class="td-td" style="${P}margin:0;">La información se facilita únicamente como guía.</p>
<p class="td-td" style="${P}margin:8px 0 0;font-weight:bold;">Confirmá siempre con fuentes oficiales del gobierno antes de emitir.</p>
</td></tr></table>
</td></tr>`;
}

function mailCabotaje({ appName, piernas, lista, now, aviso }) {
  const partes = [];
  if (aviso) partes.push(pTexto(AVISO_30, 'margin-bottom:14px;'));
  partes.push('<p style="margin:0 0 22px;font-size:15px;line-height:1.45;color:#111827;font-family:Arial,Helvetica,sans-serif;">Vuelo de cabotaje.</p>');
  piernas.forEach((p, i) => partes.push(pVuelo(p, i === 0)));
  for (const pax of lista) {
    const linea = pax.pending ? 'Pendiente de vincular: verificar nacionalidad y documentación.' : esArgentino(pax) ? 'Viaja con DNI.' : 'Viaja con pasaporte, no con DNI argentino.';
    partes.push(pTexto(nombrePasajero(pax), 'margin-top:18px;font-weight:bold;'));
    partes.push(pTexto(linea, 'margin-top:4px;'));
  }
  return {
    subject: 'Vuelo de cabotaje',
    html: marcoEmail({ appName, now, filas: [`<tr><td style="padding-top:36px;">${partes.join('\n')}</td></tr>`] }),
  };
}

export function buildRequisitosEmail({ appName = 'TravelDocs', reserva, pasajeros = [], alCrear = false, now = Date.now() } = {}) {
  const piernas = reserva?.piernas || [];
  const ids = new Set(reserva?.pasajeros || pasajeros.map(p => p.id));
  const lista = pasajeros.filter(p => !reserva?.pasajeros || ids.has(p.id));
  const quienes = lista.length ? lista : pasajeros;
  const pendientes = (reserva?.pendingPassengers || []).map(p => ({ lastname: p.lastname, firstname: p.firstname, pending: true }));
  const aviso = alCrear && !requisitosAlertDue(primeraFecha(reserva), now);
  if (esCabotaje(piernas)) return mailCabotaje({ appName, piernas, lista: [...quienes, ...pendientes], now, aviso });

  const { destinos, desconocidos } = destinosDe(piernas);
  const salidas = exposicionDePiernas(piernas);
  const bloques = armarBloques(destinos, quienes, salidas);
  const n = bloques.length || destinos.length;
  const frase = n === 1 ? 'este destino' : 'estos destinos';
  const subject = `Requisitos migratorios y sanitarios para ${frase}`;

  const intro = [];
  if (aviso) intro.push(pTexto(AVISO_30, 'margin-bottom:14px;'));
  intro.push(`<p style="margin:0 0 22px;font-size:15px;line-height:1.45;color:#111827;font-family:Arial,Helvetica,sans-serif;">Requisitos migratorios y sanitarios para ${esc(frase)}.</p>`);
  piernas.forEach((p, i) => intro.push(pVuelo(p, i === 0)));
  for (const pax of quienes) {
    const pass = pasaportesDe(pax);
    intro.push(pTexto(`${trato(pax)} ${nombrePasajero(pax)}`, 'margin-top:18px;font-weight:bold;'));
    intro.push(pTexto(pass.length ? `Usted tiene ${listaY(pass.map(x => x.etiqueta))}.` : 'No tiene pasaporte cargado.', 'margin-top:4px;'));
  }
  for (const pax of pendientes) intro.push(pTexto(`${nombrePasajero(pax)} - Pendiente de vincular: verificar nacionalidad y documentación.`, 'margin-top:18px;'));
  for (const code of desconocidos) intro.push(pTexto(`No identificamos el país de ${code}.`, 'margin-top:14px;'));

  const filas = [`<tr><td style="padding-top:36px;">${intro.join('\n')}</td></tr>`];
  for (const g of agrupar(bloques)) filas.push(htmlGrupo(g));
  filas.push(avisoLegal());
  return { subject, html: marcoEmail({ appName, now, filas }) };
}
