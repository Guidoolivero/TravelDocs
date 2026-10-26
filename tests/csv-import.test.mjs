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

test('los vencimientos de dos digitos usan el siglo actual sin cambiar nacimientos', () => {
  const p = excelRowToPassenger(['20DEC86', '20DEC30', '20/12/30', '20DEC30', 'AA123', '30123456'], { dob: 0, pargExp: 1, dniExp: 2, 'ASISTENCIA.1.fin': 3, pargNum: 4, dniNum: 5 });
  assert.equal(p.dob, '1986-12-20');
  assert.equal(p.parg.exp, '2030-12-20');
  assert.equal(p.dni.exp, '2030-12-20');
  assert.equal(p.asistencias[0].fin, '2030-12-20');
});

test('los vencimientos historicos de dos digitos no se convierten en documentos futuros', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-26T12:00:00Z') });
  const p = excelRowToPassenger(['20DEC99', 'AA123'], { pargExp: 0, pargNum: 1 });
  assert.equal(p.parg.exp, '1999-12-20');
});
