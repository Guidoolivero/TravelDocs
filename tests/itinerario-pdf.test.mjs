import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseItinerarioTexto, fechaIso, textoDesdeItems, claseItinerario, normalizarOcr } from '../public/js/itinerario-pdf.mjs';

// Misma disposicion que un itinerario emitido (Flight N, fecha en ingles,
// IATA sueltos, "CM 328", "Non Stop", espera de conexion y +1). Sin datos de pasajero.
const FIXTURE = `
Your booking is issued
Passengers Details
PAX UNO (ADT)
TKT
000
Flight 1
06 October 2026 – Buenos Aires > Panama
03:48
7h 22m
EZE
Copa
Buenos Aires
---Non Stop---
09:10
PTY
Panama
CM 328
Business
Passengers
SOL, ANA
Seat
Checked bag
-
Wait of 2 hours 36 minutes in Panama - Tocumen airport (different plane)
Page 1 of 2
Flight 2
06 October 2026 – Panama > Aruba
11:46
1h 58m
PTY
Copa
---Non Stop---
Panama
14:44
AUA
Aruba
CM 768
Business
Passengers
Seat
SOL, ANA
Flight 3
Checked bag
-
13 October 2026 – Aruba > Panama
12:14
2h 3m
AUA
Copa
---Non Stop---
Aruba
13:17
PTY
Panama
CM 633
Business
Passengers
Seat
SOL, ANA
Flight 4
Checked bag
-
16 October 2026 – Panama > Buenos Aires
19:25
7h 11m
PTY
Copa
---Non Stop---
Panama
04:36 +1
EZE
Buenos Aires
CM 454
Business
Passengers
SOL, ANA
Page 2 of 2
`;

describe('itinerario PDF', () => {
  it('toma los tramos del itinerario emitido y deja afuera la espera y los nombres', () => {
    assert.deepEqual(parseItinerarioTexto(FIXTURE), [
      { vuelo: 'CM328', origen: 'EZE', destino: 'PTY', fecha: '06OCT26' },
      { vuelo: 'CM768', origen: 'PTY', destino: 'AUA', fecha: '06OCT26' },
      { vuelo: 'CM633', origen: 'AUA', destino: 'PTY', fecha: '13OCT26' },
      { vuelo: 'CM454', origen: 'PTY', destino: 'EZE', fecha: '16OCT26' },
    ]);
    assert.equal(fechaIso('06OCT26'), '2026-10-06');
    assert.equal(fechaIso('16OCT26'), '2026-10-16');
  });

  it('no inventa tramos si el PDF no tiene ese texto', () => {
    assert.deepEqual(parseItinerarioTexto(''), []);
    assert.deepEqual(parseItinerarioTexto('solo un recibo de hotel'), []);
  });

  it('lee un e-ticket con aeropuerto--ciudad, vuelo y fecha GDS', () => {
    const texto = `
DATE OF ISSUE:13MAR26
ORIGIN/DES
PVG--Shanghai
HND--Tokyo
MU539
R
13OCT
1430
1830
13OCT26/13OCT26
OK
FARE CALCULATION:
13OCT26PVG MU HND 295.00END ROE1.000000
T1
3
PD XT 44.10YQ/PD12.70CN
PD44.10 YQ
PD12.70 CN
(CEA)
`;
    assert.deepEqual(parseItinerarioTexto(texto), [
      { vuelo: 'MU539', origen: 'PVG', destino: 'HND', fecha: '13OCT26' },
    ]);
  });

  it('lee el itinerario de Amadeus en espanol y no toma el vuelo operado ni el billete', () => {
    const texto = `
7 OF 15
A350-900
Fecha de emision:
16 Septiembre
2026
Miércoles 23 Septiembre 2026
Aerolineas Argentinas AR 7200
(Operado por Ita Airways, AZ681)
Salida
23 Septiembre 12:55
Buenos Aires, (Ministro Pistarini) (+)
Llegada
24 Septiembre 06:40
Rome, (Fiumicino) (+)
Viernes 23 Octubre 2026
Aerolineas Argentinas AR 1141
Salida
23 Octubre 19:15
Rome, (Fiumicino) (+)
Llegada
24 Octubre 04:40
Buenos Aires, (Ministro Pistarini) (+)
A330
Billete electronico AR 044-4821527306 para PAX UNO
`;
    assert.deepEqual(parseItinerarioTexto(texto), [
      { vuelo: 'AR7200', origen: 'EZE', destino: 'FCO', fecha: '23SEP26' },
      { vuelo: 'AR1141', origen: 'FCO', destino: 'EZE', fecha: '23OCT26' },
    ]);
  });

  it('lee el e-ticket LATAM aunque el anio no este escrito', () => {
    const hoy = Date.parse('2026-10-11T15:00:00-03:00');
    const texto = `
VUELO IDA
DICIEMBRE
AEP
LIM
Jorge Newbery, Terminal
(AEP)
08:40
11:30
(LIM)
2464
( Operado por LAN Peru)
A320
24
04h 50m
2440
( Operado por LAN Peru)
A320
DICIEMBRE
24
JUEVES
LIM
AUA
(LIM)
(AUA)
VUELO DE REGRESO
ENERO
2441
( Operado por LAN Peru)
A320
7
JUEVES
AUA
LIM
(AUA)
(LIM)
ENERO
2977
( Operado por LAN Peru)
A320
7
JUEVES
LIM
EZE
(LIM)
(EZE)
`;
    assert.deepEqual(parseItinerarioTexto(texto, hoy), [
      { vuelo: 'LA2464', origen: 'AEP', destino: 'LIM', fecha: '24DEC26' },
      { vuelo: 'LA2440', origen: 'LIM', destino: 'AUA', fecha: '24DEC26' },
      { vuelo: 'LA2441', origen: 'AUA', destino: 'LIM', fecha: '07JAN27' },
      { vuelo: 'LA2977', origen: 'LIM', destino: 'EZE', fecha: '07JAN27' },
    ]);
  });

  it('lee el e-ticket con Osaka Kansai y Hong Kong, y no toma la fecha de emision ni el impuesto', () => {
    const texto = `
BOOKING, TOKYO
Date: 30Mar2026
OSAKA KANSAI HONG KONG CX503
23Oct2026
23Oct2026
KIXHKG
Fare Calculation: OSA CX HKG300.21NUC300.21END
JPY PD 320 OI
JPY PD 3310 SW
JPY PD 1000 TK
JPY PD 8000 YR
`;
    assert.deepEqual(parseItinerarioTexto(texto), [
      { vuelo: 'CX503', origen: 'KIX', destino: 'HKG', fecha: '23OCT26' },
    ]);
  });

  it('respeta el orden del texto aunque la pagina siguiente arranque mas arriba', () => {
    const items = [
      { str: 'Flight 1', transform: [1, 0, 0, 1, 10, 100] },
      { str: '06 October 2026', transform: [1, 0, 0, 1, 10, 80] },
      { str: 'EZE', transform: [1, 0, 0, 1, 10, 60] },
      { str: 'PTY', transform: [1, 0, 0, 1, 40, 60] },
      { str: 'CM', transform: [1, 0, 0, 1, 10, 40] },
      { str: '328', transform: [1, 0, 0, 1, 30, 40] },
      { str: 'Flight 2', transform: [1, 0, 0, 1, 10, 700] },
      { str: '06 October 2026', transform: [1, 0, 0, 1, 10, 680] },
      { str: 'PTY', transform: [1, 0, 0, 1, 10, 660] },
      { str: 'AUA', transform: [1, 0, 0, 1, 40, 660] },
      { str: 'CM 768', transform: [1, 0, 0, 1, 10, 640] },
    ];
    assert.deepEqual(parseItinerarioTexto(textoDesdeItems(items)), [
      { vuelo: 'CM328', origen: 'EZE', destino: 'PTY', fecha: '06OCT26' },
      { vuelo: 'CM768', origen: 'PTY', destino: 'AUA', fecha: '06OCT26' },
    ]);
  });

  it('lee octubre aunque la foto haya salido con un cero', () => {
    const texto = normalizarOcr('OSAKA KANSAI\nHONG KONG\nCX503\n230ct2026');
    assert.deepEqual(parseItinerarioTexto(texto), [
      { vuelo: 'CX503', origen: 'KIX', destino: 'HKG', fecha: '23OCT26' },
    ]);
  });

  it('acepta el PDF y la foto del itinerario, y deja afuera otro archivo', () => {
    assert.equal(claseItinerario({ type: 'application/pdf', name: 'x.bin' }), 'pdf');
    assert.equal(claseItinerario({ type: '', name: 'boleto.PDF' }), 'pdf');
    assert.equal(claseItinerario({ type: 'image/jpeg', name: 'foto.jpg' }), 'imagen');
    assert.equal(claseItinerario({ type: 'image/heic', name: 'IMG.heic' }), 'imagen');
    assert.equal(claseItinerario({ type: '', name: 'captura.png' }), 'imagen');
    assert.equal(claseItinerario({ type: 'text/plain', name: 'nota.txt' }), '');
    assert.equal(claseItinerario({ type: 'image/svg+xml', name: 'dibujo.svg' }), '');
  });
});
