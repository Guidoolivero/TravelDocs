import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horarioLocal, guardarHorario, localAArgentina } from '../public/js/reservas/horarios.mjs';
import { buildAlertEmail } from '../public/js/alertas/alert-core.mjs';

test('salidas locales se convierten segun aeropuerto y fecha, sin perder medianoche', () => {
  assert.equal(localAArgentina('2027-03-07T23:59', 'DEN'), '2027-03-08T03:59');
  assert.equal(localAArgentina('2027-03-17T20:15', 'MIA'), '2027-03-17T21:15');
  assert.equal(localAArgentina('2027-02-28T08:20', 'MIA'), '2027-02-28T10:20');
  assert.equal(localAArgentina('2027-03-15T23:59', 'DEN'), '2027-03-16T02:59');
  assert.equal(localAArgentina('2027-03-07T23:59', 'ZZZ'), null);
  assert.equal(localAArgentina('2027-03-14T02:30', 'DEN'), null);
  assert.equal(localAArgentina('2027-11-07T01:30', 'DEN'), null);
});

test('legacy ART se presenta local y se guarda sin una segunda conversion', () => {
  const legacy = { fecha:'2027-03-08T03:59', origen:'DEN', notified:true };
  assert.equal(horarioLocal(legacy), '2027-03-07T23:59');
  const saved = guardarHorario(legacy, horarioLocal(legacy));
  assert.equal(saved.fecha, legacy.fecha);
  assert.equal(saved.fechaLocal, '2027-03-07T23:59');
  assert.equal(saved.notified, true);
});

test('email muestra salida local y apertura en ART para 24/48/72 horas', () => {
  for (const horas of [24,48,72]) {
    const {html} = buildAlertEmail({ checkins:[{pax:'PRUEBA', vuelo:'AA2139', ruta:'DEN-MIA', origen:'DEN', fecha:'2027-03-08T03:59', horasAntes:horas}] });
    assert.match(html, /07 mar.*23:59/);
    assert.match(html, /hora local/);
    assert.match(html, new RegExp(`0${8-horas/24} mar.*03:59`));
    assert.match(html, /Horario argentino para hacer el check-in/);
  }
});

test('editar legacy durante hora repetida DST conserva el instante conocido', () => {
  const p = {fecha:'2027-11-07T04:30',origen:'DEN'};
  assert.equal(horarioLocal(p), '2027-11-07T01:30');
  assert.equal(guardarHorario(p, horarioLocal(p)).fecha, p.fecha);
});
