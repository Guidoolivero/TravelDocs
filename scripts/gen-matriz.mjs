#!/usr/bin/env node
// Genera lib/requisitos/matriz.mjs desde docs/travel-db.json:
//  - MATRIZ_VISAS: destinos de las matrices multinacionalidad con regimen de visa
//    y sanidad clasificados por nacionalidad (+ el texto crudo para la tarjeta).
//  - URLS_PAISES: 144 paises de los regionales con URL oficial de visa y
//    sanidad (para llenar tarjetas sin URL cuando la verificacion web no llega).
//
// Consumo: SOLO el backend (netlify/functions/gemini-travel.cjs via
// lib/requisitos/travel-matriz.mjs). No se importa en el browser: pesa ~300KB y la
// inyeccion la hace la function antes de devolver la respuesta.
//
// Flujo: editar los Excel -> python3 scripts/excel-to-travel-db.py ->
// python3 scripts/normalize-travel-db.py -> node scripts/gen-matriz.mjs.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'docs', 'travel-db.json');
const OUT = join(__dirname, '..', 'lib', 'requisitos', 'matriz.mjs');

const db = JSON.parse(readFileSync(SRC, 'utf-8'));

function textoSanidadTarjeta(texto) {
  const s = texto || '';
  if (s.startsWith('Condicional: certificado de fiebre amarilla.')) return s;
  return s.slice(0, 400);
}

// Texto largo del regional (solo argentinos) cuando la celda de la matriz
// es un shorthand ("EXIGIDA.").
const regionalPorIso = new Map();
for (const reg of Object.values(db.regiones)) {
  for (const p of reg.paises) {
    if (p.iso3) regionalPorIso.set(p.iso3, (p.sanidad?.requisito || '').slice(0, 400));
  }
}

// ── MATRIZ_VISAS ──
const matriz = [];
for (const mm of Object.values(db.matrices_multinacionalidad)) {
  for (const d of mm.destinos) {
    const porNacionalidad = {};
    for (const [nat, n] of Object.entries(d.normalizado || {})) {
      const celda = d.por_nacionalidad[nat] || {};
      porNacionalidad[nat] = {
        regimen: n.regimen,
        duracion: n.duracion_estadia || '',
        // El visado de la tarjeta sigue en 400 caracteres.
        // La sanidad de Guatemala y Cuba abre con esta frase y trae las dos
        // reglas juntas; Excel no las limita a 400 (el tope de celda es 32767).
        // El resto de las celdas mantiene el recorte de la tarjeta.
        texto: (celda.visa || '').slice(0, 400),
        sanidad: n.sanidad || '',
        texto_sanidad: textoSanidadTarjeta(celda.sanidad)
      };
    }
    matriz.push({
      iso3: [d.iso3],
      iatas: [],
      nombres: [d.pais.toUpperCase()],
      sanidad_arg: regionalPorIso.get(d.iso3) || '',
      por_nacionalidad: porNacionalidad
    });
  }
}

// ── URLS_PAISES (regionales) ──
const urls = [];
for (const reg of Object.values(db.regiones)) {
  for (const p of reg.paises) {
    urls.push({
      iso3: [p.iso3],
      iatas: [],
      nombres: [p.pais.toUpperCase()],
      visa_url: p.visa.url_oficial || '',
      sanidad_url: p.sanidad.url_oficial || ''
    });
  }
}

const header =
  '// GENERADO por scripts/gen-matriz.mjs desde docs/travel-db.json.\n' +
  '// No editar a mano: regenerar tras actualizar los Excel (ver comentario del script).\n' +
  '// Solo para consumo del backend (gemini-travel.cjs); NO importar en el browser.\n\n';

const body =
  `export const MATRIZ_VISAS = ${JSON.stringify(matriz)};\n\n` +
  `export const URLS_PAISES = ${JSON.stringify(urls)};\n`;

writeFileSync(OUT, header + body, 'utf-8');
console.log(`OK -> ${OUT} (${matriz.length} destinos matriz, ${urls.length} paises urls)`);
