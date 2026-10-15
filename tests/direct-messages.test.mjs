import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECT_MESSAGES, findDirectMessage } from '../public/js/direct-messages.mjs';

describe('findDirectMessage', () => {
  const list = [
    { id: 'm1', email: 'natalia@transitarviajes.com.ar', title: 'Gracias' },
  ];

  it('encuentra el mensaje por email exacto', () => {
    assert.equal(findDirectMessage(list, 'natalia@transitarviajes.com.ar')?.id, 'm1');
  });

  it('ignora mayusculas y espacios alrededor', () => {
    assert.equal(findDirectMessage(list, '  Natalia@TransitarViajes.com.ar ')?.id, 'm1');
  });

  it('no devuelve nada para otro email', () => {
    assert.equal(findDirectMessage(list, 'otro@agencia.com'), null);
  });

  it('no devuelve nada sin email', () => {
    assert.equal(findDirectMessage(list, ''), null);
    assert.equal(findDirectMessage(list, null), null);
  });
});

describe('DIRECT_MESSAGES (datos)', () => {
  it('todo mensaje tiene id unico, email y firma validos', () => {
    const ids = new Set();
    for (const m of DIRECT_MESSAGES) {
      assert.match(m.id, /^[\w-]+$/);
      assert.ok(!ids.has(m.id), `id repetido: ${m.id}`);
      ids.add(m.id);
      assert.match(m.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
      assert.ok(m.paragraphs?.length, 'sin parrafos');
      assert.equal(m.signature?.length, 2, 'firma = [nombre, marca]');
    }
  });
});
