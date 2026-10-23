import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, excelRowToPassenger } from '../public/js/csv-import.mjs';

test('importa observaciones, contacto opcional, varios FFN y asistencia sin perder direccion', () => {
  const headers = ['APELLIDO', 'NOMBRE', 'OBSERVACIONES', 'DIRECCION', 'EMERGENCIA TELEFONO', 'FFN AEROLINEA', 'FFN NUMERO', 'FFN 2 AEROLINEA', 'FFN 2 NUMERO', 'ASISTENCIA NUMERO', 'ASISTENCIA FIN', 'ASISTENCIA DURACION'];
  const row = ['Beraldi','Jose','Ventana','Calle 123','+5491111111111','AA','000123','AR','00456','V001','20/12/2026','365'];
  const fields = Object.fromEntries(headers.map((h,i) => [csvField(h), i]));
  const p = excelRowToPassenger(row, fields);
  assert.equal(p.notes, 'Ventana · Direccion: Calle 123');
  assert.equal(p.emergencyContact.phone, '+5491111111111');
  assert.deepEqual(p.ffn, [{airline:'AA',number:'000123'},{airline:'AR',number:'00456'}]);
  assert.equal(p.asistencias[0].fin, '2026-12-20');
  assert.equal(p.asistencias[0].duracion, '365');
});
test('campos opcionales ausentes no impiden importar y columnas desconocidas se identifican', () => {
  const p = excelRowToPassenger(['Perez'], {lastname:0});
  assert.equal(p.lastname, 'PEREZ');
  assert.deepEqual(p.emergencyContact, {name:'',relationship:'',phone:''});
  assert.equal(csvField('CONTRASENA'), undefined);
});
