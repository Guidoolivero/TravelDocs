import { ZONAS_IATA } from './aeropuertos-zonas.mjs';

const ART = 'America/Argentina/Buenos_Aires';
export function zonaAeropuerto(iata) {
  const zona = ZONAS_IATA[String(iata || '').trim().toUpperCase()];
  if (!zona) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: zona }); return zona; }
  catch { return null; }
}

function fechaEnZona(ms, zona) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(ms));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

// Busca los offsets a ambos lados de un cambio DST y exige un unico instante.
export function localAArgentina(local, origen) {
  const zona = zonaAeropuerto(origen);
  if (!zona || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local || '')) return null;
  const naive = Date.parse(local + ':00Z');
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0,16) !== local) return null;
  const candidatos = new Set();
  for (const delta of [-36,0,36]) {
    const sample = naive + delta * 3600000;
    const offset = Date.parse(fechaEnZona(sample,zona) + ':00Z') - sample;
    const instant = naive - offset;
    if (fechaEnZona(instant,zona) === local) candidatos.add(instant);
  }
  return candidatos.size === 1 ? fechaEnZona([...candidatos][0],ART) : null;
}

export function horarioLocal(p) {
  if (p.fechaLocal) return p.fechaLocal;
  const zona = zonaAeropuerto(p.origen);
  if (!zona || !p.fecha) return null;
  const ms = Date.parse(p.fecha.length === 16 ? p.fecha + ':00-03:00' : p.fecha);
  return Number.isFinite(ms) ? fechaEnZona(ms,zona) : null;
}

export function guardarHorario(p, local) {
  // Una hora repetida por DST conserva el instante ya conocido al editar.
  const anterior = p.fecha && horarioLocal({ ...p, fechaLocal:'' }) === local ? p.fecha : '';
  return { ...p, fecha:anterior || localAArgentina(local,p.origen) || '', fechaLocal:local, zonaHoraria:zonaAeropuerto(p.origen) || '' };
}
