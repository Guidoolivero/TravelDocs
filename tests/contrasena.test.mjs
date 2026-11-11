import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generarContrasena } from '../public/js/compartido/contrasena.mjs';

const CONSONANTES = 'bcdfghjkmnpqrstvwxyz';
const VOCALES = 'aeiou';

// Estilo jaqwaq-heqni9-gijBag: tres grupos de 6, un digito y una mayuscula.
describe('generarContrasena', () => {
  it('arma tres grupos pronunciables con un numero y una mayuscula', () => {
    for (let n = 0; n < 40; n++) {
      const pass = generarContrasena();
      assert.match(pass, /^[a-z2-9]{6}-[a-z2-9]{6}-[a-z2-9]{6}$/i);
      const plano = pass.replaceAll('-', '');
      assert.equal((plano.match(/[2-9]/g) || []).length, 1);
      assert.equal((plano.match(/[A-Z]/g) || []).length, 1);
      assert.equal((plano.match(/[a-z]/g) || []).length, 16);
      for (let i = 0; i < plano.length; i++) {
        const ch = plano[i];
        const vocal = i % 6 === 1 || i % 6 === 4;
        if (/[2-9]/.test(ch)) {
          assert.equal(vocal, false);
          continue;
        }
        const alfabeto = vocal ? VOCALES : CONSONANTES;
        assert.equal(alfabeto.includes(ch.toLowerCase()), true);
      }
    }
  });

  it('no repite la misma clave seguido', () => {
    const muchas = new Set(Array.from({ length: 8 }, () => generarContrasena()));
    assert.ok(muchas.size > 1);
  });
});
