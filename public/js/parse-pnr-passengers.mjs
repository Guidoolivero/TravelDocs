// Nombres de un PNR Amadeus pegado. No usa IA: Gemini a veces toma la D de
// "2.D IMPERIO" como si fuera parte del numero de linea y deja solo IMPERIO.
// Corta antes de la primera linea de vuelo (AA900 o AA 900). Si no, el
// sufijo "E AA/QSLTFP" (e-ticket + localizador) se lee como un pasajero.

const FLIGHT = /(?:^|\s)\d+\s+[A-Z0-9]{2}\s*\d{1,4}\b/i;

export function isAirlineLocatorName(apellido, nombre) {
  const ap = String(apellido || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const no = String(nombre || '').replace(/\s+/g, ' ').trim().toUpperCase();
  return /^(?:E\s+)?[A-Z0-9]{2,3}$/.test(ap) && /^[A-Z0-9]{5,7}$/.test(no) && !no.includes(' ');
}

export function parsePnrPassengers(text) {
  const header = [];
  for (const line of String(text || '').split(/\r\n|\n|\r/)) {
    if (/^\s*\d+\s+[A-Z0-9]{2}\s*\d{1,4}\b/i.test(line)) break;
    header.push(line);
  }
  let block = header.join(' ').toUpperCase().replace(/\s+/g, ' ').trim();
  const flight = block.search(FLIGHT);
  if (flight >= 0) block = block.slice(0, flight).trim();
  const out = [];
  const re = /(?:^|\s)(?:\d+\.)?([A-Z][A-Z '\u2019.-]*?)\/([A-Z][A-Z '\u2019.-]+?)(?:\s*\((CHD|INF)\))?(?=\s+\d+\.|\s*$)/g;
  let m;
  while ((m = re.exec(block))) {
    const apellido = m[1].replace(/\s+/g, ' ').trim();
    const nombre = m[2].replace(/\s+/g, ' ').trim();
    if (apellido.length < 2 || !nombre) continue;
    if (isAirlineLocatorName(apellido, nombre)) continue;
    out.push({ apellido, nombre, tipo: m[3] || 'ADT' });
  }
  return out;
}
