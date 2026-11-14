const { localAArgentina, zonaAeropuerto } = require('../../../../public/js/reservas/horarios.mjs');
const MESES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// El GDS es la fuente de las horas: no dejar que el modelo las convierta.
function horariosDelPnr(texto, hoy) {
  const out = [];
  for (const linea of String(texto || '').split('\n')) {
    const m = linea.match(/\b([A-Z0-9]{2})\s*(\d{1,4})\s+[A-Z]\s+(\d{2})([A-Z]{3})\s+\d\*?\s*([A-Z]{3})([A-Z]{3})\s+[A-Z]{2}\d+\s+(\d{4})\s+(\d{4})(?:\s+(\d{2})([A-Z]{3}))?/);
    if (!m || /\bFLWN\b/.test(linea)) continue;
    const fecha = (dia,mes,hora,desde) => {
      const month = MESES.indexOf(mes)+1;
      if (!month || !/^([01]\d|2[0-3])[0-5]\d$/.test(hora)) return null;
      let year = Number(desde.slice(0,4));
      const md = `${String(month).padStart(2,'0')}-${dia}`;
      if (`${year}-${md}` < desde.slice(0,10)) year++;
      return `${year}-${md}T${hora.slice(0,2)}:${hora.slice(2)}`;
    };
    const salida = fecha(m[3],m[4],m[7],hoy);
    if (!salida) continue;
    const llegada = m[9] ? fecha(m[9],m[10],m[8],salida) : null;
    out.push({ vuelo:m[1]+m[2], origen:m[5], destino:m[6], salida, llegada });
  }
  return out;
}

function normalizarHorarios(segmentos, texto, hoy) {
  const horarios = horariosDelPnr(texto,hoy);
  return (Array.isArray(segmentos) ? segmentos : []).filter(s => s && s.fecha_salida).map(s => {
    const i = horarios.findIndex(h => h.vuelo === String(s.vuelo).replace(/\s/g,'') && h.origen === s.origen && h.destino === s.destino);
    const h = i >= 0 ? horarios.splice(i,1)[0] : null;
    const local = h?.salida || s.fecha_salida;
    const llegada = h?.llegada || s.fecha_llegada || local;
    return { ...s, fechaLocal:local, zonaHoraria:zonaAeropuerto(s.origen) || '',
      fecha_salida:localAArgentina(local,s.origen),
      fecha_llegada:localAArgentina(llegada,s.destino),
      sinHora:!h && (/T00:01$/.test(local || '') || /T23:59$/.test(llegada || '')),
    };
  });
}
module.exports = { normalizarHorarios };
