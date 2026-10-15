#!/usr/bin/env node
// ============================================================
//  ocr-regression.mjs — Harness de regresión OCR (versión liviana)
//
//  Pasa un set fijo de documentos (tests/ocr-fixtures/) por la
//  Netlify Function gemini-scan REAL (deployada o netlify dev) y
//  compara la extracción contra un golden (tests/ocr-fixtures/golden.json).
//
//  Reproduce la compresión de Fase 2A en node (sharp, mismos params
//  que scanner.js prepareImageForScan) → valida que comprimir no rompe
//  la extracción. Registra source=gemini|claude por fixture.
//
//  Modos:
//    node scripts/ocr-regression.mjs --snapshot   → corre el pipeline y
//      guarda la salida como golden (armar baseline la 1ra vez).
//    node scripts/ocr-regression.mjs              → corre y compara contra
//      golden; exit 1 si hay regresión (≥10% de campos críticos con diff).
//
//  Env vars requeridas:
//    OCR_TEST_EMAIL     — usuario de test de Firebase (ej. agencia-piloto)
//    OCR_TEST_PASSWORD  — su contraseña
//    OCR_SCAN_URL       — opcional, default http://localhost:8888/.netlify/functions/gemini-scan
//      (usar la URL de staging para probar deployado)
//
//  Limitaciones:
//  - LLM no determinista: se compara con normalización + umbral 90%.
//  - Claude solo se ejercita si Gemini falla en el run (no se fuerza).
//  - PDF y GIF pasan sin comprimir (igual que prepareImageForScan).
// ============================================================

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { FIREBASE_CONFIG } from '../public/js/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES_DIR = path.join(ROOT, 'tests', 'ocr-fixtures');
const GOLDEN_PATH = path.join(FIXTURES_DIR, 'golden.json');

const SCAN_URL = process.env.OCR_SCAN_URL || 'http://localhost:8888/.netlify/functions/gemini-scan';
const TEST_EMAIL = process.env.OCR_TEST_EMAIL;
const TEST_PASSWORD = process.env.OCR_TEST_PASSWORD;
const SNAPSHOT = process.argv.includes('--snapshot');
const DELAY_MS = 4000; // pausa entre requests (rate limit Gemini ~15 req/min)

// ── Parámetros 2A (espejo de scanner.js prepareImageForScan) ──
const MAX_LONG_SIDE = 1600;
const JPEG_QUALITY = 80;
const SKIP_BYTES = 400 * 1024;

const CRITICAL_FIELDS = [
  'tipo', 'apellido', 'nombre', 'numero', 'numero_pasaporte', 'numero_dni',
  'fecha_nacimiento', 'fecha_emision', 'fecha_vencimiento',
  'sexo', 'nacionalidad', 'pais_emisor', 'pais_destino_visa', 'tipo_visa'
];
const NON_CRITICAL = ['lugar_emision', 'producto', 'cobertura'];
const ALL_FIELDS = [...CRITICAL_FIELDS, ...NON_CRITICAL];

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf'
};
const COMPRESSIBLE_EXTS = ['jpg', 'jpeg', 'png', 'webp']; // gif y pdf pasan intactos
const FIXTURE_GLOBS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf'];

// ============================================================
//  Auth Firebase (REST) → ID token para verifyAuth
// ============================================================
async function getIdToken() {
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error('Falta OCR_TEST_EMAIL / OCR_TEST_PASSWORD (usuario de test de Firebase).');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_CONFIG.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, returnSecureToken: true })
  });
  const json = await res.json();
  if (!res.ok || !json.idToken) {
    throw new Error(`Login Firebase falló: ${json.error?.message || res.status}`);
  }
  return json.idToken;
}

// ============================================================
//  Compresión 2A en node (espejo de prepareImageForScan)
// ============================================================
async function prepareImage(buf, ext) {
  if (!COMPRESSIBLE_EXTS.includes(ext)) return { buf, mime: MIME_BY_EXT[ext] };
  // smart skip: JPEG ya chico → no se toca
  if ((ext === 'jpg' || ext === 'jpeg') && buf.length <= SKIP_BYTES) {
    return { buf, mime: 'image/jpeg' };
  }
  try {
    const out = await sharp(buf)
      .rotate() // rotación EXIF
      .resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    const origKB = Math.round(buf.length / 1024);
    const outKB = Math.round(out.length / 1024);
    console.log(`  [2A] compresión: ${origKB}KB → ${outKB}KB`);
    return { buf: out, mime: 'image/jpeg' };
  } catch (err) {
    console.warn(`  [2A] compresión falló (${err.message}), usando original`);
    return { buf, mime: MIME_BY_EXT[ext] };
  }
}

// ============================================================
//  Llamada a gemini-scan
// ============================================================
async function scanOne(idToken, fileName) {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`Extensión no soportada: .${ext}`);

  const raw = await readFile(path.join(FIXTURES_DIR, fileName));
  const { buf, mime: sendMime } = await prepareImage(raw, ext);
  const data = buf.toString('base64');

  const res = await fetch(SCAN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: JSON.stringify({ mimeType: sendMime, data })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`scan ${res.status}: ${json.error || 'error desconocido'}`);

  const text = json.text || '';
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]+\}/); // fence markdown o ruido
    result = m ? JSON.parse(m[0]) : {};
  }
  return { result, source: json.source || '?' };
}

// ============================================================
//  Normalización para comparación tolerante
// ============================================================
function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normText(v) {
  return stripDiacritics(String(v ?? '').trim().toUpperCase()).replace(/\s+/g, ' ').trim();
}
function normDoc(v) {
  return normText(v).replace(/[^A-Z0-9]/g, '');
}
const MONTHS = { JAN:'01',ENE:'01',FEB:'02',MAR:'03',APR:'04',ABR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',AGO:'08',SEP:'09',SET:'09',OCT:'10',NOV:'11',DEC:'12',DIC:'12' };
function normDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})\s*([A-Za-z]{3})\s*(\d{4})$/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2,'0')}`;
  return normText(s);
}
const DATE_FIELDS = new Set(['fecha_nacimiento', 'fecha_emision', 'fecha_vencimiento']);
const DOC_FIELDS = new Set(['numero', 'numero_pasaporte', 'numero_dni']);
function normField(name, v) {
  if (DATE_FIELDS.has(name)) return normDate(v);
  if (DOC_FIELDS.has(name)) return normDoc(v);
  return normText(v);
}

// ============================================================
//  Comparación
// ============================================================
function compare(expected, actual) {
  const diffs = [];
  let critMatch = 0;
  for (const f of ALL_FIELDS) {
    const e = normField(f, expected?.[f]);
    const a = normField(f, actual?.[f]);
    if (e === a) {
      if (CRITICAL_FIELDS.includes(f)) critMatch++;
    } else {
      diffs.push({ field: f, expected: e, actual: a, critical: CRITICAL_FIELDS.includes(f) });
    }
  }
  const critPct = Math.round((critMatch / CRITICAL_FIELDS.length) * 100);
  return { diffs, critPct, pass: critPct >= 90 };
}

// ============================================================
//  Main
// ============================================================
async function main() {
  if (!existsSync(FIXTURES_DIR)) {
    console.error(`No existe ${FIXTURES_DIR}. Creala y agregá documentos de prueba.`);
    process.exit(1);
  }

  const files = (await readdir(FIXTURES_DIR))
    .filter(f => FIXTURE_GLOBS.includes(path.extname(f).toLowerCase()) && f !== 'golden.json')
    .sort();

  if (!files.length) {
    console.error(`No hay documentos en ${FIXTURES_DIR}. Agregá pasaporte/visa/DNI/ESTA/PDF reales.`);
    console.error('Nombrá los archivos en snake-case (ej: passport-arg.jpg, visa-usa.jpg).');
    process.exit(1);
  }

  const golden = existsSync(GOLDEN_PATH)
    ? JSON.parse(await readFile(GOLDEN_PATH, 'utf8'))
    : {};

  if (!SNAPSHOT && Object.keys(golden).length === 0) {
    console.error('No hay golden. Corré primero: npm run ocr:snapshot');
    process.exit(1);
  }

  console.log(`OCR REGRESSION — ${files.length} fixture(s)`);
  console.log(`Endpoint: ${SCAN_URL}`);
  console.log(`Modo: ${SNAPSHOT ? 'SNAPSHOT (armar golden)' : 'COMPARE'}`);
  console.log('─'.repeat(60));

  const idToken = await getIdToken();

  const newGolden = {};
  let passCount = 0;
  let claudeCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    process.stdout.write(`[${i + 1}/${files.length}] ${file} ... `);
    let entry;
    try {
      const { result, source } = await scanOne(idToken, file);
      if (source === 'claude') claudeCount++;
      newGolden[file] = result;

      if (SNAPSHOT) {
        console.log(`source=${source} → guardado en golden`);
      } else {
        const cmp = compare(golden[file], result);
        if (cmp.pass) passCount++;
        const diffCrit = cmp.diffs.filter(d => d.critical).length;
        const tag = cmp.pass ? 'OK' : 'FAIL';
        console.log(`source=${source}  ${tag}  (${cmp.critPct}% críticos${diffCrit ? `, ${diffCrit} diff crítico(s)` : ''})`);
        for (const d of cmp.diffs) {
          console.log(`    ${d.critical ? '⚠' : '·'} ${d.field}: "${d.expected}" ≠ "${d.actual}"`);
        }
      }
    } catch (err) {
      console.log(`ERROR — ${err.message}`);
      if (!SNAPSHOT) process.exitCode = 1;
    }
    if (i < files.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log('─'.repeat(60));
  if (SNAPSHOT) {
    await writeFile(GOLDEN_PATH, JSON.stringify(newGolden, null, 2) + '\n');
    console.log(`✓ Golden guardado en tests/ocr-fixtures/golden.json (${files.length} fixtures).`);
    console.log('  Revisalo a ojo antes de usarlo como baseline — si un campo está mal, corregilo a mano.');
  } else {
    console.log(`${passCount}/${files.length} fixtures pasan el umbral (≥90% campos críticos).`);
    if (claudeCount) console.log(`Fallback Claude usado en ${claudeCount}/${files.length} fixtures este run.`);
    if (passCount < files.length) process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
