import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from './helpers/checkin-fixture.mjs';

const segment = (extra = {}) => ({ vuelo: 'UX1134', vueloDocumento: '1134', compania: 'AR', companiaFuente: 'logo', companiaEvidencia: 'Logo del condor', fecha_salida: '2026-10-24T15:05', fecha_llegada: '2026-10-25T03:20', origen: 'EZE', destino: 'MAD', reservaVuelo: 'TEST01', ...extra });

test('handler PDF sin texto deja el numero sin prefijo y la compania vacia, sin sugerencias', async () => {
  const { data } = await interpret([[segment()]], { pdf: 'cGRm' });
  assert.equal(data.piernas[0].vuelo, '1134');
  assert.equal(data.piernas[0].compania, '');
  assert.ok(!data.piernas[0].companiaSugerida);
  assert.equal(data.piernas[0].companiaPendiente, true);
});

test('handler verifica el texto extraido aunque Gemini afirme otra aerolinea', async () => {
  const { data } = await interpret([[segment({ compania: 'UX', companiaFuente: 'texto', companiaEvidencia: 'Air Europa' })]], { pdf: 'cGRm', pdfText: 'AR1134 EZE MAD' });
  assert.equal(data.piernas[0].compania, 'AR');
  assert.equal(data.piernas[0].vuelo, 'AR1134');
  assert.equal(data.piernas[0].companiaPendiente, false);
});

test('varios PDFs verifican cada segmento solo contra el texto de su propio documento', async () => {
  const { data } = await interpret([[segment()], [segment()]], { pdfs: ['cGRm', 'cGRm'], pdfTexts: ['AR1134 EZE MAD', 'IB1134 EZE MAD'] });
  assert.deepEqual(data.piernas.map(p => p.compania), ['AR', 'IB']);
  const missing = await interpret([[segment()], [segment()]], { pdfs: ['cGRm', 'cGRm'], pdfTexts: ['AR1134 EZE MAD'] });
  assert.ok(missing.data.piernas.every(p => p.companiaPendiente));
});

test('varios PDFs conservan cada confirmacion y no fusionan conexiones con operadora incierta', async () => {
  const { data } = await interpret([[segment()], [segment({ vuelo: 'UX2000', vueloDocumento: '2000', origen: 'MAD', destino: 'BCN', fecha_salida: '2026-10-25T05:00', fecha_llegada: '2026-10-25T06:00' })]], { pdfs: ['cGRm', 'cGRm'] });
  assert.equal(data.piernas.length, 2);
  assert.deepEqual(data.piernas.map(p => p.companiaPendiente), [true, true]);
  assert.deepEqual(data.piernas.map(p => p.vuelo), ['1134', '2000']);
});

test('PNR escrito mantiene el vuelo y la compania sin requerir evidencia de PDF', async () => {
  const { data } = await interpret([[segment({ vuelo: 'AR1134', compania: 'AR', companiaFuente: undefined, companiaEvidencia: undefined })]], { pnr: 'AR1134 EZE MAD' });
  assert.equal(data.piernas[0].vuelo, 'AR1134');
  assert.equal(data.piernas[0].compania, 'AR');
  assert.equal(data.piernas[0].companiaPendiente, false);
});

test('el JSON incompleto no rompe la lectura y tampoco confirma una aerolinea sin evidencia', async () => {
  const { data } = await interpret([[null, segment({ companiaFuente: undefined, companiaEvidencia: undefined })]], { pdf: 'cGRm' });
  assert.equal(data.piernas[0].compania, '');
  assert.equal(data.piernas[0].companiaPendiente, true);
});
