#!/usr/bin/env node
// Genera public/js/conocidos.mjs desde docs/conocidos.json (fuente unica de
// PAISES_CONOCIDOS + ALERTAS_CONOCIDAS). Los regex se guardan en el JSON como
// { __regex, __flags } y aca se compilan a RegExp.
//
// Flujo: editar docs/conocidos.json -> correr `node scripts/gen-conocidos.mjs`
// -> travel-reqs.mjs (frontend) y gemini-travel.cjs (backend) ven el cambio.
// El .mjs generado NO se edita a mano.
//

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'docs', 'conocidos.json');
const OUT = join(__dirname, '..', 'public', 'js', 'conocidos.mjs');

function compilar(obj) {
  if (Array.isArray(obj)) return obj.map(compilar);
  if (obj && typeof obj === 'object') {
    if (typeof obj.__regex === 'string') return new RegExp(obj.__regex, obj.__flags || '');
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = compilar(v);
    return out;
  }
  return obj;
}

const json = JSON.parse(readFileSync(SRC, 'utf-8'));
const paises = compilar(json.paises);
const alertas = compilar(json.alertas);

const header =
  '// GENERADO por scripts/gen-conocidos.mjs desde docs/conocidos.json.\n' +
  '// No editar a mano: editar el JSON y regenerar (node scripts/gen-conocidos.mjs).\n\n';

// JSON.stringify serializa RegExp como {} — usamos un replacer que emite
// new RegExp(source, flags) para que el modulo generado sea JS valido.
function serializar(v) {
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof RegExp) return { __expr: val.source, __flags: val.flags };
    return val;
  }, 2).replace(/\{\s*"__expr":\s*("(?:[^"\\]|\\.)*"),\s*"__flags":\s*("(?:[^"\\]|\\.)*")\s*\}/g,
    (_m, src, flags) => `new RegExp(${src}, ${flags})`);
}

const bodyFinal =
  `export const PAISES_CONOCIDOS = ${serializar(paises)};\n\n` +
  `export const ALERTAS_CONOCIDAS = ${serializar(alertas)};\n`;

writeFileSync(OUT, header + bodyFinal, 'utf-8');
console.log(`OK -> ${OUT} (${paises.length} paises, ${alertas.length} alertas)`);
