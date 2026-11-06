import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function staticGraph(entry) {
  const seen = new Set();
  function walk(file) {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    assert.ok(fs.existsSync(abs), `Import inexistente: ${abs}`);
    seen.add(abs);
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/from ['"](\.\.?\/[^'"]+)['"]/g)) {
      walk(path.resolve(path.dirname(abs), m[1]));
    }
  }
  walk(entry);
  return [...seen].map(f => path.basename(f));
}

describe('bundle inicial de app.mjs', () => {
  const files = staticGraph('public/js/app.mjs');

  it('no arrastra conocidos, travel-reqs, scanner ni itinerario al boot', () => {
    assert.equal(files.includes('conocidos.mjs'), false);
    assert.equal(files.includes('travel-reqs.mjs'), false);
    assert.equal(files.includes('scanner.js'), false);
    assert.equal(files.includes('itinerario-pdf.mjs'), false);
  });
});
