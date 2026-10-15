// Clave para dictar: jaqwaq-heqni9-gijBag. crypto.getRandomValues, no Math.random.

const CONSONANTES = 'bcdfghjkmnpqrstvwxyz';
const VOCALES = 'aeiou';
const DIGITOS = '23456789';

function aleatorio(max) {
  const buf = new Uint8Array(1);
  const tope = 256 - (256 % max);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= tope);
  return n % max;
}

function tomar(alfabeto) {
  return alfabeto[aleatorio(alfabeto.length)];
}

export function generarContrasena() {
  const chars = [];
  const huecos = [];
  for (let g = 0; g < 3; g++) {
    const base = g * 6;
    chars.push(
      tomar(CONSONANTES), tomar(VOCALES),
      tomar(CONSONANTES), tomar(CONSONANTES),
      tomar(VOCALES), tomar(CONSONANTES)
    );
    huecos.push(base, base + 2, base + 3, base + 5);
  }
  const iNum = huecos.splice(aleatorio(huecos.length), 1)[0];
  const iMay = huecos[aleatorio(huecos.length)];
  chars[iNum] = tomar(DIGITOS);
  chars[iMay] = chars[iMay].toUpperCase();
  return `${chars.slice(0, 6).join('')}-${chars.slice(6, 12).join('')}-${chars.slice(12).join('')}`;
}
