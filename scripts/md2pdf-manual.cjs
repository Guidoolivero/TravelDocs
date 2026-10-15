// Genera MANUAL-USUARIO.pdf desde MANUAL-USUARIO.md (marked + Chrome headless).
// Portada: bandas azules + avion + wordmark TravelDocs (diseno aprobado 27/08/2026).
// Uso: node scripts/md2pdf-manual.cjs [entrada.md] [salida.pdf]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { marked } = require('marked');

const DOCS = path.resolve(__dirname, '../docs');
const inFile = process.argv[2] || 'MANUAL-USUARIO.md';
const outFile = process.argv[3] || 'MANUAL-USUARIO.pdf';
let md = fs.readFileSync(path.join(DOCS, inFile), 'utf8');
// El H1 del md se reemplaza por la portada
md = md.replace(/^# .*?\n/, '');

const body = marked.parse(md, { gfm: true });
const fecha = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  .replace(/^./, c => c.toUpperCase());

const plane = `<svg viewBox="0 0 24 24" width="120" height="120" fill="none" stroke="#1a3a5c" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Manual del Usuario</title>
<base href="file://${DOCS}/">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.55; margin: 0; }
  .cover { page-break-after: always; height: 257mm; display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 34mm; position: relative; }
  .cover .band { position: absolute; top: 0; left: 0; right: 0; height: 14mm; background: #1a3a5c; }
  .cover .band-bottom { position: absolute; bottom: 0; left: 0; right: 0; height: 14mm; background: #1a3a5c; }
  .cover .icon { margin-bottom: 10mm; }
  .cover .brand { font-size: 40pt; font-weight: 700; color: #1a3a5c; letter-spacing: .5px; }
  .cover .brand small { display: block; font-size: 10.5pt; font-weight: 400; color: #6b7280; letter-spacing: 2.5px; margin-top: 3mm; text-transform: uppercase; }
  .cover .doc-title { margin-top: 20mm; font-size: 24pt; font-weight: 600; color: #111827; border-top: 2px solid #1a3a5c; border-bottom: 2px solid #1a3a5c; padding: 6mm 14mm; }
  .cover .doc-sub { margin-top: 8mm; font-size: 12pt; color: #4b5563; line-height: 1.7; }
  .cover .doc-meta { position: absolute; bottom: 24mm; font-size: 10pt; color: #6b7280; letter-spacing: 1px; }
  h1 { font-size: 22pt; color: #1a3a5c; border-bottom: 3px solid #1a3a5c; padding-bottom: 8px; margin-top: 0; }
  h2 { font-size: 15pt; color: #1a3a5c; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; margin-top: 26px; page-break-after: avoid; }
  h3 { font-size: 12.5pt; color: #2563eb; margin-top: 18px; page-break-after: avoid; }
  img { max-width: 100%; margin: 6px 0 10px; border: 1px solid #e2e0d8; border-radius: 6px; page-break-inside: avoid; }
  code { font-family: 'SF Mono', Menlo, monospace; background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 9.5pt; }
  pre { background: #f3f4f6; padding: 10px 14px; border-radius: 8px; overflow-x: hidden; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; page-break-inside: avoid; }
  th { background: #1a3a5c; color: #fff; padding: 6px 10px; text-align: left; font-size: 10pt; }
  td { border: 1px solid #d1d5db; padding: 5px 10px; font-size: 10pt; }
  tr:nth-child(even) td { background: #f8fafc; }
  blockquote { border-left: 4px solid #2563eb; background: #eff6ff; margin: 12px 0; padding: 8px 14px; color: #1e40af; border-radius: 0 6px 6px 0; }
  hr { border: none; border-top: 1px solid #d1d5db; margin: 22px 0; }
  a { color: #2563eb; text-decoration: none; }
  ol, ul { padding-left: 22px; }
  li { margin: 3px 0; }
</style>
</head>
<body>
<div class="cover">
  <div class="band"></div>
  <div class="icon">${plane}</div>
  <div class="brand">TravelDocs<small>Gestion de Documentos</small></div>
  <div class="doc-title">Manual del Usuario</div>
  <div class="doc-sub">Pasajeros &middot; Check-ins &middot; Documentos &middot; Alertas<br>Importacion masiva &middot; Requisitos de Vuelo</div>
  <div class="doc-meta">Version 1 &middot; ${fecha}</div>
  <div class="band-bottom"></div>
</div>
${body}
</body>
</html>`;

const tmpHtml = '/tmp/manual-usuario.html';
fs.writeFileSync(tmpHtml, html);

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outPdf = path.join(DOCS, outFile);
execFileSync(chrome, [
  '--headless', '--disable-gpu', '--no-pdf-header-footer',
  '--virtual-time-budget=30000',
  `--print-to-pdf=${outPdf}`,
  `file://${tmpHtml}`,
], { stdio: 'inherit' });

console.log('PDF generado:', outPdf);
