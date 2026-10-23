import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFormReminders, dueFormReminders } from '../public/js/form-reminders.mjs';
import { buildAlertEmail } from '../public/js/alert-core.mjs';

test('recordatorio abre siete dias antes en calendario argentino y cierra al completar o pasar el ingreso', () => {
  const forms = [{ id: 'form-1', title: 'Formulario de ingreso', date: '2026-11-01', daysBefore: 7, completed: false }];
  assert.equal(validateFormReminders(forms), '');
  const reservations = [{ id: 'res1', formReminders: forms }];
  assert.equal(dueFormReminders(reservations, Date.parse('2026-10-25T02:59:00Z')).length, 0);
  const [due] = dueFormReminders(reservations, Date.parse('2026-10-25T03:00:00Z'));
  assert.equal(due.title, forms[0].title);
  assert.equal(due.reservationId, 'res1');
  assert.equal(dueFormReminders(reservations, Date.parse('2026-11-02T03:00:00Z')).length, 0);
  forms[0].completed = true;
  assert.equal(dueFormReminders(reservations, Date.parse('2026-10-25T03:00:00Z')).length, 0);
});

test('rechaza fechas inexistentes, plazos invalidos y recordatorios sin identificador', () => {
  const valid = { id: 'a', title: 'Ingreso', date: '2026-11-01', daysBefore: 7 };
  for (const change of [{ date: '2026-02-30' }, { daysBefore: -1 }, { daysBefore: 1.5 }, { daysBefore: 366 }, { id: '' }, { title: ' ' }]) {
    assert.ok(validateFormReminders([{ ...valid, ...change }]));
  }
  assert.equal(validateFormReminders([]), '');
});

test('email de formularios incluye pasajero y fecha, escapando texto de usuario', () => {
  const { subject, html } = buildAlertEmail({ formularios: [{title:'<img src=x>', pax:'PEREZ & ANA', date:'2026-11-01'}] });
  assert.match(subject, /Formularios/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /PEREZ &amp; ANA/);
  assert.doesNotMatch(html, /<img src=x>/);
});
