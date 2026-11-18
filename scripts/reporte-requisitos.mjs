import { pathToFileURL } from 'node:url';
import { getFirestore } from './lib/firebase-admin.mjs';

function porcentaje(ok, intentos) {
  return intentos ? 100 * ok / intentos : null;
}

function tiempos(valores) {
  valores.sort((a, b) => a - b);
  const n = valores.length;
  const medianaMs = n ? (valores[Math.floor((n - 1) / 2)] + valores[Math.floor(n / 2)]) / 2 : null;
  return { muestras: n, medianaMs, p95Ms: n ? valores[Math.ceil(n * 0.95) - 1] : null };
}

function fase(filas, nombre) {
  const fases = filas.map(f => f[nombre]).filter(Boolean);
  const cerradas = fases.filter(f => f.estado !== 'sin_cierre');
  function grupo(cache) {
    const registros = cerradas.filter(f => f.cache === cache);
    const estados = {};
    for (const f of registros) estados[f.estado] = (estados[f.estado] || 0) + 1;
    return { estados, exitoPct: porcentaje(estados.ok || 0, registros.length), ...tiempos(registros.map(f => f.duracionMs)) };
  }
  return {
    intentos: fases.length, exitoPct: porcentaje(fases.filter(f => f.estado === 'ok').length, fases.length),
    sin_iniciar: filas.length - fases.length,
    sin_cierre: fases.length - cerradas.length,
    cache: grupo(true), enVivo: grupo(false),
  };
}

export function resumir(filas) {
  const completas = filas.filter(f => f.analisis?.estado === 'ok' && f.verificacion?.estado === 'ok').length;
  const cerradas = filas.filter(f => Number.isFinite(f.verificacion?.fin));
  return {
    consultas: filas.length, completas, exitoPct: porcentaje(completas, filas.length),
    analisis: fase(filas, 'analisis'), verificacion: fase(filas, 'verificacion'),
    hastaVerificacion: tiempos(cerradas.map(f => f.verificacion.fin - f.analisis.inicio)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const campana = getFirestore().collection('travelMonitoring').doc('requisitos-30d');
  const config = (await campana.get()).data();
  if (!config) {
    console.log('Todavía no se registraron consultas.');
  } else {
    const snapshot = await campana.collection('consultas').get();
    console.log(JSON.stringify({
      inicio: new Date(config.inicio), fin: new Date(config.fin),
      ...resumir(snapshot.docs.map(d => d.data())),
    }, null, 2));
  }
}
