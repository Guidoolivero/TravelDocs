import { it } from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRE_2FA, REQUIRE_2FA_FROM } from '../public/js/config.js';

// La activacion programada del 2FA debe caer el 21/09/2026 a las 00:00 de Argentina (UTC-3).
// Un typo en el offset de zona cambiaria el dia real de activacion y bloquearia (o no) logins.
it('REQUIRE_2FA_FROM es el 21/09/2026 00:00 ART (= 03:00 UTC)', () => {
  assert.equal(REQUIRE_2FA_FROM.toISOString(), '2026-09-21T03:00:00.000Z');
});

it('REQUIRE_2FA sigue a la fecha programada (false antes, true despues)', () => {
  assert.equal(REQUIRE_2FA, Date.now() >= REQUIRE_2FA_FROM.getTime());
});
