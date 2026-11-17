import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../public/js/compartido/ui.mjs';

test('esc escapa comillas: un dato no puede romper un atributo HTML', () => {
  const sucio = `https://x" onmouseover="alert(1)' x='`;
  const limpio = esc(sucio);
  assert.ok(!limpio.includes('"') && !limpio.includes("'"));
  assert.equal(esc('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});
