// Nombres de un PNR Amadeus pegado. No usa IA: Gemini a veces toma la D de
// "2.D IMPERIO" como si fuera parte del numero de linea y deja solo IMPERIO.

export function parsePnrPassengers(text) {
  const header = [];
  for (const line of String(text || '').split(/\n/)) {
    if (/^\s*\d+\s+[A-Z0-9]{2}\d/i.test(line)) break;
    header.push(line);
  }
  const block = header.join(' ').toUpperCase().replace(/\s+/g, ' ').trim();
  const out = [];
  const re = /(?:^|\s)(?:\d+\.)?([A-Z][A-Z '\u2019.-]*?)\/([A-Z][A-Z '\u2019.-]+?)(?:\s*\((CHD|INF)\))?(?=\s+\d+\.|\s*$)/g;
  let m;
  while ((m = re.exec(block))) {
    const apellido = m[1].replace(/\s+/g, ' ').trim();
    const nombre = m[2].replace(/\s+/g, ' ').trim();
    if (apellido.length < 2 || !nombre) continue;
    if (/^[A-Z0-9]{2,3}$/.test(apellido) && /^[A-Z0-9]{5,7}$/.test(nombre) && !nombre.includes(' ')) continue;
    out.push({ apellido, nombre, tipo: m[3] || 'ADT' });
  }
  return out;
}
