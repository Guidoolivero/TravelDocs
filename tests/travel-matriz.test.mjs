// Tests de la inyeccion nationality-aware (paso 4) y el fallback de URLs (paso 5).
// Los datos vienen de js/matriz.mjs (generado desde los Excel verificados).

import test from 'node:test';
import assert from 'node:assert/strict';
import { injectMatrizVisas, injectMatrizSanidad, fillKnownUrls } from '../lib/travel-matriz.mjs';

const stop = (iso3, tipo = 'destino', requisitos = []) => ({
  pais_codigo: iso3, pais: '', aeropuerto_iata: '', tipo, requisitos
});

test('injectMatrizVisas: argentinos tambien inyectan (Kenia solo existe en matrices)', () => {
  // Las matrices cubren 193 destinos vs los 146 de conocidos.mjs: para paises
  // sin entrada en conocidos (ej Kenia y su eTA), la columna Argentina de la
  // matriz es la fuente determinista.
  const data = { ruta: [stop('KEN')] };
  injectMatrizVisas(data, 'Argentina (ARG)');
  const reqs = data.ruta[0].requisitos;
  assert.equal(reqs.length, 1);
  assert.match(reqs[0].nombre, /ETA/);
  assert.equal(reqs[0].obligatorio, true);
  assert.match(reqs[0].nota_fuentes, /Matriz de visados/);
});

test('injectMatrizVisas: brasileno a EEUU -> requiere visa B1/B2', () => {
  const data = { ruta: [stop('USA')] };
  injectMatrizVisas(data, 'Brasil (BRA)');
  const reqs = data.ruta[0].requisitos;
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].categoria, 'visado');
  assert.match(reqs[0].nombre, /Requiere visa/);
  assert.equal(reqs[0].obligatorio, true);
  assert.equal(reqs[0].verificado_web, true);
  assert.match(reqs[0].nota_fuentes, /Matriz de visados/);
});

test('injectMatrizVisas: espanol a EEUU -> ETA por VWP (columna UE/EEE no homogenea)', () => {
  const data = { ruta: [stop('USA')] };
  injectMatrizVisas(data, 'España (ESP)');
  const reqs = data.ruta[0].requisitos;
  assert.equal(reqs.length, 1);
  assert.match(reqs[0].nombre, /ETA/);
  assert.equal(reqs[0].obligatorio, true);
});

test('injectMatrizVisas: espanol a Chile -> exenta (obligatorio false)', () => {
  const data = { ruta: [stop('CHL')] };
  injectMatrizVisas(data, 'España (ESP)');
  const reqs = data.ruta[0].requisitos;
  assert.equal(reqs.length, 1);
  assert.match(reqs[0].nombre, /No requiere visa/);
  assert.equal(reqs[0].obligatorio, false);
});

test('injectMatrizVisas: dedup — si el modelo ya genero tarjeta de visa, no inyecta', () => {
  const data = { ruta: [stop('USA', 'destino', [
    { categoria: 'visado', nombre: 'US B1/B2 visa', obligatorio: true }
  ])] };
  injectMatrizVisas(data, 'Brasil (BRA)');
  assert.equal(data.ruta[0].requisitos.length, 1, 'no agrega otra tarjeta');
});

test('injectMatrizVisas: nacionalidad sin columna (Rusia) no inyecta', () => {
  const data = { ruta: [stop('USA')] };
  injectMatrizVisas(data, 'Rusia (RUS)');
  assert.equal(data.ruta[0].requisitos.length, 0);
});

test('injectMatrizVisas: nacionalidad = pais destino (na) no inyecta', () => {
  const data = { ruta: [stop('BRA')] };
  injectMatrizVisas(data, 'Brasil (BRA)');
  assert.equal(data.ruta[0].requisitos.length, 0);
});

test('injectMatrizVisas: parada tecnica y origen no reciben tarjetas', () => {
  const data = { ruta: [stop('USA', 'origen'), stop('USA', 'parada_tecnica')] };
  injectMatrizVisas(data, 'Brasil (BRA)');
  assert.equal(data.ruta[0].requisitos.length, 0);
  assert.equal(data.ruta[1].requisitos.length, 0);
});

test('injectMatrizSanidad: argentino a Jamaica exige fiebre amarilla', () => {
  const data = { ruta: [stop('JAM')] };
  injectMatrizSanidad(data, 'Argentina (ARG)');
  const reqs = data.ruta[0].requisitos;
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].categoria, 'vacuna');
  assert.match(reqs[0].nombre, /fiebre amarilla/i);
  assert.equal(reqs[0].obligatorio, true);
  assert.match(reqs[0].descripcion, /Argentina/i);
  assert.match(reqs[0].nota_fuentes, /Matriz de sanidad/);
});

test('injectMatrizSanidad: chileno a Jamaica no la exige', () => {
  const data = { ruta: [stop('JAM')] };
  injectMatrizSanidad(data, 'Chile (CHL)');
  const reqs = data.ruta[0].requisitos;
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].obligatorio, false);
  assert.match(reqs[0].nombre, /no se exige/i);
});

test('injectMatrizSanidad: dedup si ya hay tarjeta de fiebre amarilla', () => {
  const data = { ruta: [stop('JAM', 'destino', [
    { categoria: 'vacuna', nombre: 'Fiebre amarilla', obligatorio: true }
  ])] };
  injectMatrizSanidad(data, 'Argentina (ARG)');
  assert.equal(data.ruta[0].requisitos.length, 1);
});

test('injectMatrizSanidad: origen y nacionalidad sin columna no inyectan', () => {
  const data = { ruta: [stop('JAM', 'origen'), stop('JAM')] };
  injectMatrizSanidad(data, 'Rusia (RUS)');
  assert.equal(data.ruta[0].requisitos.length, 0);
  assert.equal(data.ruta[1].requisitos.length, 0);
});

test('fillKnownUrls: completa URL faltante de visa y sanidad desde el Excel', () => {
  const data = { ruta: [stop('ESP', 'destino', [
    { categoria: 'visado', nombre: 'Visa Schengen', url_oficial: '' },
    { categoria: 'vacuna', nombre: 'Fiebre amarilla', url_oficial: '' },
    { categoria: 'PLF', nombre: 'Formulario X', url_oficial: 'https://ya-cargada.gob/' }
  ])] };
  fillKnownUrls(data);
  const [visa, vacuna, plf] = data.ruta[0].requisitos;
  assert.ok(/exteriores\.gob\.es/.test(visa.url_oficial), 'visa obtiene URL de visa');
  assert.ok(vacuna.url_oficial.length > 0, 'vacuna obtiene URL de sanidad');
  assert.equal(plf.url_oficial, 'https://ya-cargada.gob/', 'no pisa URL existente');
});

test('fillKnownUrls: pais sin entrada en regionales queda igual', () => {
  const data = { ruta: [stop('ZZZ', 'destino', [
    { categoria: 'visado', nombre: 'X', url_oficial: '' }
  ])] };
  fillKnownUrls(data);
  assert.equal(data.ruta[0].requisitos[0].url_oficial, '');
});
