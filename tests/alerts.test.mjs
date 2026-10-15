import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPassengerVisas,
  visaAlertLabel,
  collectDocumentAlertItems,
  collectEmailAlertCandidates,
  passengerOverallStatus,
  docStatus,
  daysUntil
} from '../public/js/utils.js';
import {
  parseFechaART,
  hoyART,
  anioART,
  diaART,
  diasEntre,
  diasHastaART,
  checkinAlertDue,
  requisitosAlertDue,
  diasHastaVuelo,
  proximaFechaVuelo,
  claveOrdenCheckin,
  colorDiasViaje,
  reservationStale,
  isBirthdayToday,
  buildAlertEmail
} from '../public/js/alert-core.mjs';

function daysFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const basePassenger = {
  id: 'p1',
  lastname: 'GARCIA',
  firstname: 'JUAN',
  email: 'juan@test.com',
  dni: { num: '123', exp: daysFromNow(200) },
  parg: { num: 'PA123', exp: daysFromNow(200) }
};

describe('getPassengerVisas', () => {
  it('lee visas[] completo incluyendo posición 3+', () => {
    const p = {
      visas: [
        { country: 'USA', num: 'V1', exp: daysFromNow(10) },
        { country: 'ESP', num: 'V2', exp: daysFromNow(50) },
        { country: 'USA', type: 'E', num: 'ESTA-99', exp: daysFromNow(15) }
      ],
      visa1: { country: 'ITA', num: 'legacy1', exp: daysFromNow(5) },
      visa2: { country: 'FRA', num: 'legacy2', exp: daysFromNow(5) }
    };
    const visas = getPassengerVisas(p);
    assert.equal(visas.length, 3);
    assert.equal(visas[2].num, 'ESTA-99');
  });

  it('hace fallback a visa1/visa2 cuando visas[] está vacío', () => {
    const p = {
      visa1: { country: 'USA', num: 'V1', exp: daysFromNow(10) },
      visa2: { country: 'ESP', num: 'V2', exp: daysFromNow(50) }
    };
    assert.equal(getPassengerVisas(p).length, 2);
  });

  it('ignora visas sin fecha de vencimiento', () => {
    const p = { visas: [{ country: 'USA', num: 'X' }] };
    assert.equal(getPassengerVisas(p).length, 0);
  });
});

describe('visaAlertLabel', () => {
  it('etiqueta ESTA cuando type es E', () => {
    assert.equal(visaAlertLabel({ type: 'E', country: 'USA' }), 'ESTA');
  });

  it('etiqueta Visa con país para otros tipos', () => {
    assert.equal(visaAlertLabel({ type: 'B', country: 'USA' }), 'Visa USA');
  });
});

describe('collectDocumentAlertItems — ESTA', () => {
  it('genera alerta crítica para ESTA en visas[2] a 15 días', () => {
    const p = {
      ...basePassenger,
      visas: [
        { country: 'ESP', num: 'V1', exp: daysFromNow(200) },
        { country: 'ITA', num: 'V2', exp: daysFromNow(200) },
        { country: 'USA', type: 'E', num: 'ESTA-1', exp: daysFromNow(15) }
      ]
    };
    const items = collectDocumentAlertItems([p]);
    const esta = items.filter(i => i.docType === 'ESTA');
    assert.equal(esta.length, 1);
    assert.equal(esta[0].urgency, 2);
    assert.equal(esta[0].days, daysUntil(daysFromNow(15)));
  });

  it('no duplica ESTA de visa1 cuando también está en visas[]', () => {
    const exp = daysFromNow(20);
    const p = {
      ...basePassenger,
      visas: [{ country: 'USA', type: 'E', num: 'E1', exp }],
      visa1: { country: 'USA', type: 'E', num: 'E1', exp }
    };
    const items = collectDocumentAlertItems([p]);
    assert.equal(items.filter(i => i.docType === 'ESTA').length, 1);
  });
});

describe('collectDocumentAlertItems — Asistencia al Viajero', () => {
  it('alerta asistencia largo plazo a 20 días (urgency crítica)', () => {
    const p = {
      ...basePassenger,
      asistencias: [{ num: 'VCH-001', fin: daysFromNow(20), duracion: '365' }]
    };
    const items = collectDocumentAlertItems([p]);
    const asist = items.filter(i => i.docType === 'Asistencia al Viajero');
    assert.equal(asist.length, 1);
    assert.equal(asist[0].urgency, 2);
    assert.equal(asist[0].days, daysUntil(daysFromNow(20)));
  });

  it('no alerta asistencia a 60 días (fuera de la ventana de 30 días)', () => {
    const p = {
      ...basePassenger,
      asistencias: [{ num: 'VCH-002', fin: daysFromNow(60), duracion: '90' }]
    };
    const items = collectDocumentAlertItems([p]);
    const asist = items.find(i => i.docType === 'Asistencia al Viajero');
    assert.equal(asist, undefined);
  });

  it('no alerta voucher corto (duracion < 30)', () => {
    const p = {
      ...basePassenger,
      asistencias: [{ num: 'VCH-003', fin: daysFromNow(5), duracion: '10' }]
    };
    const items = collectDocumentAlertItems([p]);
    assert.equal(items.filter(i => i.docType === 'Asistencia al Viajero').length, 0);
  });

  it('no duplica la misma asistencia (un solo item por vencimiento)', () => {
    const p = {
      ...basePassenger,
      asistencias: [{ num: 'VCH-004', fin: daysFromNow(10), duracion: '365' }]
    };
    const items = collectDocumentAlertItems([p]);
    assert.equal(items.filter(i => i.docType === 'Asistencia al Viajero').length, 1);
  });

  it('respeta dismissKey y no incluye alertas descartadas', () => {
    const fin = daysFromNow(10);
    const p = {
      ...basePassenger,
      asistencias: [{ num: 'VCH-005', fin, duracion: '365' }]
    };
    const dismissKey = `dismissed_${p.id}_Asistencia al Viajero_${fin}`;
    const active = collectDocumentAlertItems([p], () => false);
    const dismissed = collectDocumentAlertItems([p], key => key === dismissKey);
    assert.equal(active.length, 1);
    assert.equal(dismissed.length, 0);
  });
});

describe('collectEmailAlertCandidates', () => {
  it('incluye ESTA a 100 días pero NO asistencia a 120 días (ventana 30)', () => {
    const p = {
      ...basePassenger,
      visas: [{ country: 'USA', type: 'E', num: 'E1', exp: daysFromNow(100) }],
      asistencias: [{ num: 'VCH-10', fin: daysFromNow(120), duracion: '365' }]
    };
    const candidates = collectEmailAlertCandidates([p]);
    assert.ok(candidates.some(c => c.docType === 'ESTA'));
    assert.equal(candidates.some(c => c.docType === 'Asistencia al Viajero'), false);
  });

  it('excluye documentos vencidos y fuera de 180 días', () => {
    const p = {
      ...basePassenger,
      visas: [
        { country: 'USA', type: 'E', num: 'E-old', exp: daysFromNow(-5) },
        { country: 'USA', type: 'E', num: 'E-far', exp: daysFromNow(200) }
      ]
    };
    const candidates = collectEmailAlertCandidates([p]);
    assert.equal(candidates.filter(c => c.docType === 'ESTA').length, 0);
  });

  it('genera clave de deduplicación estable', () => {
    const exp = daysFromNow(30);
    const p = {
      ...basePassenger,
      asistencias: [{ num: 'VCH-11', fin: exp, duracion: '365' }]
    };
    const [c] = collectEmailAlertCandidates([p]).filter(x => x.docType === 'Asistencia al Viajero');
    assert.equal(c.key, `tdAlert_${p.id}_Asistencia al Viajero_${exp}`);
  });
});

describe('passengerOverallStatus', () => {
  it('marca critical si ESTA en visas[2] vence en 10 días', () => {
    const p = {
      ...basePassenger,
      dni: { exp: daysFromNow(200) },
      parg: { exp: daysFromNow(200) },
      visas: [
        { country: 'ESP', num: 'V1', exp: daysFromNow(200) },
        { country: 'ITA', num: 'V2', exp: daysFromNow(200) },
        { country: 'USA', type: 'E', num: 'E1', exp: daysFromNow(10) }
      ]
    };
    assert.equal(passengerOverallStatus(p), 'critical');
  });

  it('marca critical si asistencia largo plazo vence en 15 días', () => {
    const p = {
      ...basePassenger,
      dni: { exp: daysFromNow(200) },
      parg: { exp: daysFromNow(200) },
      asistencias: [{ fin: daysFromNow(15), duracion: '365' }]
    };
    assert.equal(passengerOverallStatus(p), 'critical');
  });

  it('no marca warning por asistencia a 60 días (solo alerta a 30)', () => {
    const p = {
      ...basePassenger,
      dni: { exp: daysFromNow(200) },
      parg: { exp: daysFromNow(200) },
      asistencias: [{ fin: daysFromNow(60), duracion: '365' }]
    };
    assert.equal(passengerOverallStatus(p), 'ok');
  });

  it('ignora voucher corto en semáforo global', () => {
    const p = {
      ...basePassenger,
      dni: { exp: daysFromNow(200) },
      parg: { exp: daysFromNow(200) },
      asistencias: [{ fin: daysFromNow(5), duracion: '7' }]
    };
    assert.equal(passengerOverallStatus(p), 'ok');
  });
});

describe('docStatus umbrales', () => {
  it('critical a 30 días, warning a 90 días', () => {
    const exp30 = daysFromNow(30);
    const exp45 = daysFromNow(45);
    const exp100 = daysFromNow(100);
    assert.ok(daysUntil(exp30) <= 30);
    assert.ok(daysUntil(exp45) > 30 && daysUntil(exp45) <= 90);
    assert.ok(daysUntil(exp100) > 90);
    assert.equal(docStatus(exp30), 'critical');
    assert.equal(docStatus(exp45), 'warning');
    assert.equal(docStatus(exp100), 'ok');
  });
});

// ── alert-core.mjs: fechas ART compartidas cliente + server ──
// Los pins usan Date.UTC: garantizan el comportamiento de producción
// (Netlify corre en UTC) sin importar el TZ del runtime de los tests.

describe('parseFechaART — offset UTC-3 explícito', () => {
  it('formato 16 chars: 12:00 ART = 15:00 UTC', () => {
    assert.equal(parseFechaART('2026-09-10T12:00'), Date.UTC(2026, 8, 10, 15, 0));
  });
  it('formato 19 chars (con segundos): 12:00 ART = 15:00 UTC', () => {
    assert.equal(parseFechaART('2026-09-10T12:00:00'), Date.UTC(2026, 8, 10, 15, 0));
  });
  it('formato 10 chars (date-only): medianoche ART = 03:00 UTC', () => {
    assert.equal(parseFechaART('2026-09-10'), Date.UTC(2026, 8, 10, 3, 0));
  });
  it('string con offset Z propio: se respeta tal cual', () => {
    assert.equal(parseFechaART('2026-09-10T15:00:00Z'), Date.UTC(2026, 8, 10, 15, 0));
  });
  it('string con offset -03:00 propio: se respeta tal cual', () => {
    assert.equal(parseFechaART('2026-09-10T12:00:00-03:00'), Date.UTC(2026, 8, 10, 15, 0));
  });
  it('formatos inválidos devuelven null', () => {
    for (const s of ['banana', '', null, undefined, '2026-9-10T12:00', '2026-09-10T12', 12345]) {
      assert.equal(parseFechaART(s), null, `esperaba null para ${JSON.stringify(s)}`);
    }
  });
});

describe('hoyART / anioART / diaART — calendario argentino', () => {
  it('02:59 UTC del 1-ene sigue siendo 31-dic ART (y año anterior)', () => {
    const now = Date.UTC(2027, 0, 1, 2, 59);
    assert.equal(hoyART(now), '2026-12-31');
    assert.equal(anioART(now), 2026);
  });
  it('03:00 UTC del 1-ene ya es 1-ene ART', () => {
    const now = Date.UTC(2027, 0, 1, 3, 0);
    assert.equal(hoyART(now), '2027-01-01');
    assert.equal(anioART(now), 2027);
  });
  it('anioART devuelve NUMBER (compat con birthdayNotifiedYear histórico)', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);
    assert.ok(typeof anioART(now) === 'number');
  });
  it('02:59 UTC sigue siendo el día anterior en ART', () => {
    const now = Date.UTC(2026, 8, 9, 2, 59);
    assert.equal(hoyART(now), '2026-09-08');
  });
  it('diaART convierte epoch a date-only ART', () => {
    assert.equal(diaART(Date.UTC(2026, 8, 9, 2, 59)), '2026-09-08');
    assert.equal(diaART(Date.UTC(2026, 8, 9, 3, 0)), '2026-09-09');
  });
});

describe('diasEntre / diasHastaART — diferencia de calendario', () => {
  it('diferencia exacta incluyendo bordes de mes y año', () => {
    assert.equal(diasEntre('2026-09-10', '2026-09-10'), 0);
    assert.equal(diasEntre('2026-09-10', '2026-09-13'), 3);
    assert.equal(diasEntre('2026-09-13', '2026-09-10'), -3);
    assert.equal(diasEntre('2025-12-31', '2026-01-02'), 2);
  });
  it('inválidos devuelven null', () => {
    assert.equal(diasEntre('banana', '2026-09-10'), null);
    assert.equal(diasEntre(null, '2026-09-10'), null);
  });
  it('diasHastaART cuenta desde el hoy ART (no desde el TZ del runtime)', () => {
    // 01:00 UTC del 10-sep: en ART todavía es 9-sep (22:00) -> un vencimiento
    // el 11-sep está a 2 días para ART; un cálculo con fecha local en runtime
    // UTC diría 1. Este es el desfasaje que el server no puede tener.
    const now = Date.UTC(2026, 8, 10, 1, 0);
    assert.equal(diasHastaART('2026-09-11', now), 2);
    assert.equal(diasHastaART('2026-09-09', now), 0);
    assert.equal(diasHastaART('banana', now), null);
  });
});

describe('checkinAlertDue — días de anticipación (no reloj)', () => {
  // El caso de regresión del usuario: vuelo mañana 21:00, el agente entra
  // hoy 9:00 ART -> faltan 36hs de reloj pero es el día anterior -> alerta.
  it('vuelo mañana 21:00 + ahora hoy 09:00 ART con 24 -> true', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);   // 9-sep 12:00 UTC = 09:00 ART
    assert.equal(checkinAlertDue('2026-09-10T21:00', 24, now), true);
  });
  it('vuelo mañana 21:00 + ahora hoy 23:00 ART con 24 -> true (todo el día anterior avisa)', () => {
    const now = Date.UTC(2026, 8, 10, 2, 0);   // 23:00 ART del 9-sep
    assert.equal(checkinAlertDue('2026-09-10T21:00', 24, now), true);
  });
  it('vuelo hoy 21:00 + ahora hoy 09:00 ART -> true (antes de salir)', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);
    assert.equal(checkinAlertDue('2026-09-09T21:00', 24, now), true);
  });
  it('vuelo hoy 08:00 + ahora hoy 09:00 ART -> false (ya salió)', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);
    assert.equal(checkinAlertDue('2026-09-09T08:00', 24, now), false);
  });
  it('a 2 días: 24 false, 48 true; a 3 días: 48 false, 72 true; a 4 días: siempre false', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);   // 09:00 ART del 9-sep
    assert.equal(checkinAlertDue('2026-09-11T10:00', 24, now), false);
    assert.equal(checkinAlertDue('2026-09-11T10:00', 48, now), true);
    assert.equal(checkinAlertDue('2026-09-12T10:00', 48, now), false);
    assert.equal(checkinAlertDue('2026-09-12T10:00', 72, now), true);
    assert.equal(checkinAlertDue('2026-09-13T10:00', 72, now), false);
  });
  it('formato date-only (10 chars) alerta desde el día anterior 00:00 ART', () => {
    const now = Date.UTC(2026, 8, 7, 20, 0);   // 17:00 ART del 7-sep
    assert.equal(checkinAlertDue('2026-09-08', 24, now), true);
  });
  it('horasAntes inválido cae al default 24', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);
    assert.equal(checkinAlertDue('2026-09-11T10:00', 'abc', now), false); // 2 días > 1
    assert.equal(checkinAlertDue('2026-09-11T10:00', 0, now), false);
    assert.equal(checkinAlertDue('2026-09-10T21:00', undefined, now), true); // 1 día
  });
  it('fecha inválida -> false', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);
    assert.equal(checkinAlertDue('banana', 24, now), false);
    assert.equal(checkinAlertDue('', 48, now), false);
    assert.equal(checkinAlertDue(null, 72, now), false);
  });
});

describe('isBirthdayToday — calendario ART y policy 02-29', () => {
  it('00:00 ART del día del cumpleaños -> true', () => {
    const now = Date.UTC(2026, 8, 9, 3, 0);    // 9-sep 00:00 ART
    assert.equal(isBirthdayToday({ dob: '1990-09-09' }, now), true);
  });
  it('23:59 ART del día anterior -> false', () => {
    const now = Date.UTC(2026, 8, 9, 2, 59);   // 8-sep 23:59 ART
    assert.equal(isBirthdayToday({ dob: '1990-09-09' }, now), false);
  });
  it('02-29 solo coincide en años bisiestos (policy actual)', () => {
    const noBisiesto = Date.UTC(2026, 1, 28, 12, 0);  // 28-feb-2026
    const bisiesto = Date.UTC(2028, 1, 29, 12, 0);    // 29-feb-2028
    assert.equal(isBirthdayToday({ dob: '2024-02-29' }, noBisiesto), false);
    assert.equal(isBirthdayToday({ dob: '2024-02-29' }, bisiesto), true);
  });
  it('dob faltante o inválido -> false', () => {
    const now = Date.UTC(2026, 8, 9, 12, 0);
    assert.equal(isBirthdayToday({}, now), false);
    assert.equal(isBirthdayToday({ dob: 'banana' }, now), false);
  });
});

describe('proximaFechaVuelo — el próximo tramo que no salió', () => {
  const now = Date.UTC(2026, 8, 24, 15, 0); // 24-sep-2026 12:00 ART

  it('si el primero ya salió, usa el siguiente', () => {
    assert.equal(proximaFechaVuelo([
      '2026-09-10T21:00',
      '2026-10-02T22:30',
    ], now), '2026-10-02T22:30');
  });

  it('si todos salieron, se queda con el último', () => {
    assert.equal(proximaFechaVuelo([
      '2026-09-10T21:00',
      '2026-09-18T14:00',
    ], now), '2026-09-18T14:00');
  });

  it('sin fechas no devuelve nada', () => {
    assert.equal(proximaFechaVuelo([], now), null);
  });
});

describe('claveOrdenCheckin — el próximo check-in más cercano primero', () => {
  const now = Date.UTC(2026, 8, 24, 15, 0); // 24-sep-2026 12:00 ART

  it('7 días queda antes que 29, y uno ya salido queda al final', () => {
    const en7 = ['2026-10-01T06:30'];
    const en29 = ['2026-09-23T12:00', '2026-10-23T14:00'];
    const salio = ['2026-09-10T21:00'];
    assert.ok(claveOrdenCheckin(en7, now) < claveOrdenCheckin(en29, now));
    assert.ok(claveOrdenCheckin(en29, now) < claveOrdenCheckin(salio, now));
  });
});

describe('colorDiasViaje — semana roja, 15 días ámbar, después verde', () => {
  const now = Date.UTC(2026, 8, 1, 15, 0); // 1-sep-2026 12:00 ART

  it('cuenta días de calendario hasta el vuelo', () => {
    assert.equal(diasHastaVuelo('2026-09-08T21:00', now), 7);
    assert.equal(diasHastaVuelo('2026-09-16T08:00', now), 15);
    assert.equal(diasHastaVuelo('2026-09-17T08:00', now), 16);
    assert.equal(diasHastaVuelo('no-fecha', now), null);
  });

  it('7 días o menos es rojo, hasta 15 ámbar, más de 15 verde', () => {
    assert.equal(colorDiasViaje(0), 'red');
    assert.equal(colorDiasViaje(7), 'red');
    assert.equal(colorDiasViaje(8), 'amber');
    assert.equal(colorDiasViaje(15), 'amber');
    assert.equal(colorDiasViaje(16), 'green');
    assert.equal(colorDiasViaje(-1), 'red');
  });
});

describe('requisitosAlertDue — 30 días antes del primer vuelo', () => {
  // 1-sep-2026 12:00 ART
  const now = Date.UTC(2026, 8, 1, 15, 0);

  it('a 30 días entra', () => {
    assert.equal(requisitosAlertDue('2026-10-01T10:00', now), true);
  });

  it('a 31 días no entra', () => {
    assert.equal(requisitosAlertDue('2026-10-02T10:00', now), false);
  });

  it('el vuelo ya salió no entra', () => {
    assert.equal(requisitosAlertDue('2026-08-31T10:00', now), false);
  });

  it('fecha inválida no entra', () => {
    assert.equal(requisitosAlertDue('mañana', now), false);
    assert.equal(requisitosAlertDue('', now), false);
  });
});

describe('buildAlertEmail — asunto dinámico y secciones', () => {
  const vencimiento = { name: 'GARCIA, JUAN', docType: 'Pasaporte ARG', docNum: 'PA123', exp: '2026-10-10', days: 30 };
  const checkin = { pax: 'GARCIA, JUAN', vuelo: 'AA908', ruta: 'EZE-MIA', fecha: '2026-09-10T21:00', ref: 'KRBJJ' };
  const cumple = { name: 'LOPEZ, MARIA', dob: '1971-01-17' };

  it('sin contenido: subject solo el nombre de la app y sin secciones', () => {
    const { subject, html } = buildAlertEmail({ appName: 'TravelDocs' });
    assert.equal(subject, 'TravelDocs');
    assert.ok(!html.includes('Vencimientos'));
    assert.ok(!html.includes('Check-ins'));
    assert.ok(!html.includes('Cumpleaños'));
  });

  it('con las tres secciones: subject "App · Vencimientos | Check Ins | Cumpleaños"', () => {
    const { subject, html } = buildAlertEmail({ appName: 'App', vencimientos: [vencimiento], checkins: [checkin], cumpleanos: [cumple] });
    assert.equal(subject, 'App · Vencimientos | Check Ins | Cumpleaños');
    assert.ok(html.includes('Vencimientos próximos'));
    assert.ok(html.includes('Check-ins por hacer'));
    assert.ok(html.includes('Cumpleaños de hoy'));
  });

  it('secciones vacías no se renderizan ni aparecen en el subject', () => {
    const { subject, html } = buildAlertEmail({ appName: 'App', cumpleanos: [cumple] });
    assert.equal(subject, 'App · Cumpleaños');
    assert.ok(!html.includes('Vencimientos'));
    assert.ok(html.includes('Cumpleaños de hoy'));
  });

  it('check-ins: formatea fecha ART, usa columnas fijas y muestra "+N" pasajeros extra', () => {
    const { html } = buildAlertEmail({ appName: 'App', checkins: [{ ...checkin, paxCount: 3 }] });
    assert.ok(html.includes('10 sep &middot; 21:00'));
    assert.ok(html.includes('table-layout:fixed'));
    assert.ok(html.includes('Arial,Helvetica,sans-serif'));
    assert.ok(html.includes('+2'));
    assert.ok(html.includes('EZE&rarr;MIA'));
  });

  it('vencimientos: pinta de rojo los críticos (<= 30 días) y no el resto', () => {
    const { html } = buildAlertEmail({
      appName: 'App',
      vencimientos: [
        { ...vencimiento, days: 32 },
        { name: 'URGENTE, ANA', docType: 'DNI', docNum: '1', exp: '2026-09-15', days: 7 },
      ],
    });
    assert.ok(html.includes('#c0392b'));
    const filaCritica = html.split('URGENTE, ANA')[1];
    assert.ok(filaCritica.slice(0, 800).includes('#c0392b'));
    const filaNormal = html.split('GARCIA, JUAN')[1];
    assert.ok(!filaNormal.slice(0, 800).includes('#c0392b'));
  });

  it('cabecera: nombre de la app + fecha del día en ART', () => {
    const now = Date.UTC(2026, 8, 8, 15, 0); // 8-sep-2026 12:00 ART (martes)
    const { html } = buildAlertEmail({ appName: 'App', checkins: [checkin], now });
    assert.ok(html.includes('>App</span>'));
    assert.ok(html.includes('MAR 8 SEP 2026'));
  });

  it('responsive + dark mode: media queries y mini-etiquetas presentes', () => {
    const { html } = buildAlertEmail({ appName: 'App', checkins: [checkin], vencimientos: [vencimiento] });
    assert.ok(html.includes('@media (max-width: 620px)'));
    assert.ok(html.includes('@media (prefers-color-scheme: dark)'));
    assert.ok(html.includes('.td-cell { display: block'));
    assert.ok(html.includes('class="td-headrow'));
    assert.ok(html.includes('td-mlabel')); // mini-etiquetas Ref/Número en mobile
  });

  it('check-ins con email propio: no tienen sección propia en el unificado (van por email individual)', () => {
    const { subject, html } = buildAlertEmail({ appName: 'App', vencimientos: [vencimiento] });
    assert.equal(subject, 'App · Vencimientos');
    assert.ok(!html.includes('Check-ins por hacer'));
  });

  it('requisitos: asunto Verifique requisitos y sin "antes de emitir"', () => {
    const { subject, html } = buildAlertEmail({
      appName: 'Agencia Sur',
      requisitos: [{
        name: 'GARCIA, JUAN',
        nationality: 'Argentina',
        ruta: 'EZE-MBJ',
        fecha: '2026-10-01T10:00',
        vuelo: 'AA2963',
        compania: 'AA',
      }],
    });
    assert.equal(subject, 'Agencia Sur · Verifique requisitos');
    assert.ok(/verificar requisitos migratorios y sanitarios/i.test(html));
    assert.ok(!/antes de emitir/i.test(html));
    assert.ok(html.includes('GARCIA, JUAN'));
    assert.ok(html.includes('EZE'));
    assert.ok(!html.includes('Nacionalidad'));
    assert.ok(!html.includes('Vuelo'));
    assert.ok(!html.includes('Argentina'));
    assert.ok(!html.includes('AA2963'));
    assert.ok(!html.includes('TravelDocs'));
  });

  it('escapa HTML de los datos (nombres con < >)', () => {
    const { html } = buildAlertEmail({ appName: 'App', vencimientos: [{ ...vencimiento, name: 'EVIL <b>name' }] });
    assert.ok(!html.includes('<b>name'));
    assert.ok(html.includes('EVIL &lt;b&gt;name'));
  });
});

describe('reservationStale — limpieza al día siguiente del último vuelo', () => {
  // El caso del usuario: vuelo 10-oct -> el 11-oct se borra solo.
  it('vuelo 10-oct, hoy 11-oct -> true (se borra)', () => {
    const now = Date.UTC(2026, 9, 11, 15, 0); // 12:00 ART del 11-oct
    assert.equal(reservationStale([{ fecha: '2026-10-10T14:00' }], now), true);
  });
  it('vuelo 10-oct, hoy 10-oct -> false (mismo día, ya salió pero no se borra)', () => {
    const now = Date.UTC(2026, 9, 10, 20, 0); // 17:00 ART del 10-oct
    assert.equal(reservationStale([{ fecha: '2026-10-10T14:00' }], now), false);
  });
  it('ida y vuelta: la vuelta todavía no voló -> false', () => {
    const now = Date.UTC(2026, 9, 11, 15, 0);
    const piernas = [{ fecha: '2026-10-10T14:00' }, { fecha: '2026-10-29T16:00' }];
    assert.equal(reservationStale(piernas, now), false);
  });
  it('ida y vuelta: todas volaron ayer o antes -> true', () => {
    const now = Date.UTC(2026, 9, 30, 15, 0); // 30-oct
    const piernas = [{ fecha: '2026-10-10T14:00' }, { fecha: '2026-10-29T16:00' }];
    assert.equal(reservationStale(piernas, now), true);
  });
  it('tramo sin fecha -> false (no se puede saber, no se borra)', () => {
    const now = Date.UTC(2026, 9, 11, 15, 0);
    assert.equal(reservationStale([{ fecha: '2026-10-10T14:00' }, { fecha: '' }], now), false);
  });
  it('sin tramos -> false', () => {
    const now = Date.UTC(2026, 9, 11, 15, 0);
    assert.equal(reservationStale([], now), false);
    assert.equal(reservationStale(null, now), false);
  });
  it('formato date-only también cuenta', () => {
    const now = Date.UTC(2026, 9, 11, 15, 0);
    assert.equal(reservationStale([{ fecha: '2026-10-10' }], now), true);
  });
});