// Parser de segmentos GDS (Amadeus, Galileo, Sabre, WorldSpan).
// Conserva la hora local de salida y de llegada cuando la linea la trae:
// la evaluacion de fiebre amarilla necesita la duracion del transito.

function conHorarios(linea, seg) {
  const marca = seg.origen + seg.destino;
  const idx = linea.indexOf(marca);
  const resto = idx >= 0 ? linea.slice(idx + marca.length) : linea;
  const m = resto.match(/(\d{4})\s+(\d{4})(?:\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?))?/);
  if (!m) return seg;
  return {
    ...seg,
    hora_salida: m[1],
    hora_llegada: m[2],
    ...(m[3] ? { fecha_llegada: m[3] } : {}),
  };
}

export function parseGDSSegmentos(texto) {
  const resultados = [];
  for (const linea of String(texto || '').split('\n')) {
    const l = linea.toUpperCase().trim();
    if (!l) continue;

    let m;
    let seg = null;

    // Formato 1: Amadeus clasico con dia*ORIGDEST
    // Ej: "2  MU 746 R 28APR 2*EZEPVG HK1  0215 1810  29APR  E  CA/QBRHFZ"
    m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+[A-Z]\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+\d\*([A-Z]{3})([A-Z]{3})/);
    if (m) seg = { vuelo: m[1] + m[2], origen: m[4], destino: m[5], fecha: m[3] };

    // Formato 2: ORIG y DEST separados por espacio, con o sin dia
    if (!seg) {
      m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+[A-Z]\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+(?:\d\*?\s*)?([A-Z]{3})\s+([A-Z]{3})/);
      if (m) seg = { vuelo: m[1] + m[2], origen: m[4], destino: m[5], fecha: m[3] };
    }

    // Formato 3: ORIGDEST sin dia* (Galileo/Sabre/WorldSpan)
    if (!seg) {
      m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+[A-Z]\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+([A-Z]{3})([A-Z]{3})\s+(?:HK|HL|SS|UN|WK|GK|TK|RR|DK|SC|KK)/);
      if (m) seg = { vuelo: m[1] + m[2], origen: m[4], destino: m[5], fecha: m[3] };
    }

    // Formato 4: sin clase explicita
    if (!seg) {
      m = l.match(/^\s*(?:\d{1,3}\s+)?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})\s+(?:[A-Z]\s+)?(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+(?:\d\*?\s*)?([A-Z]{3})[- ]?([A-Z]{3})/);
      if (m) seg = { vuelo: m[1] + m[2], origen: m[4], destino: m[5], fecha: m[3] };
    }

    // Formato 5: ORIG DEST DATE HORA > HORA AIRLINE FLTNUM [CLASE]
    if (!seg) {
      m = l.match(/^([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+(\d{1,2}:\d{2})\s*>\s*(\d{1,2}:\d{2})(?:\s+\+(\d))?.*?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})/);
      if (m) {
        seg = {
          vuelo: m[7] + m[8],
          origen: m[1],
          destino: m[2],
          fecha: m[3],
          hora_salida: m[4],
          hora_llegada: m[5],
          ...(m[6] ? { mas_dias: m[6] } : {}),
        };
      } else {
        m = l.match(/^([A-Z]{3})\s+([A-Z]{3})\s+(\d{1,2}[A-Z]{3}(?:\d{2,4})?)\s+(\d{1,2}:\d{2}).*?([A-Z]{2}[0-9A-Z]?)\s*(\d{1,4})/);
        if (m) {
          seg = {
            vuelo: m[5] + m[6],
            origen: m[1],
            destino: m[2],
            fecha: m[3],
            hora_salida: m[4],
          };
        }
      }
    }

    if (!seg) continue;
    resultados.push(seg.hora_salida ? seg : conHorarios(l, seg));
  }
  return resultados;
}
