// shortcut: facturas 0.25.2 omite FchCotiz; quitar al actualizar a una version que acepte fecha.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const manifest = require.resolve('facturas/package.json');
assert.equal(JSON.parse(await readFile(manifest, 'utf8')).version, '0.25.2');
const file = path.join(path.dirname(manifest), 'dist/chunk-67ISWKGE.mjs');
const source = await readFile(file, 'utf8');
const before = `async getQuotation({ currencyId, representedTaxId, forceRefresh }) {
      const result = await executeWsfeAuthenticatedOperation(
        "FEParamGetCotizacion",
        {
          representedTaxId,
          forceRefresh
        },
        {
          MonId: currencyId
        }
      );`;
const after = before.replace('currencyId, representedTaxId', 'currencyId, date, representedTaxId')
  .replace('MonId: currencyId', 'MonId: currencyId,\n          ...(date === undefined ? {} : { FchCotiz: normalizeWsfeDateInput(date, "date") })');
if (!source.includes(after)) {
  assert.equal(source.split(before).length, 2, 'Cambio el SDK: revisar la adaptacion de cotizacion.');
  await writeFile(file, source.replace(before, after));
}
