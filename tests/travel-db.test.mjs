// Test de la base consolidada docs/travel-db.json: valida que TODAS las
// nacionalidades x TODOS los destinos de las matrices (y los 10 regionales)
// extraigan datos correctamente del JSON generado desde los Excel.
// Es la red de seguridad del paso de normalizacion: si un Excel cambia de
// formato o el conversor se rompe, este test lo detecta antes de que llegue
// a produccion.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(readFileSync(join(__dirname, '..', 'docs', 'travel-db.json'), 'utf-8'));

const REGIONES = Object.keys(db.regiones);
const MATRICES = Object.entries(db.matrices_multinacionalidad);
const REGIMENES = new Set([
  'exenta', 'requiere_visa', 'evisa', 'eta', 'visa_on_arrival',
  'libre_circulacion', 'na', 'sin_confirmar', 'desconocido', ''
]);
const SANIDADES = new Set([
  'sin_requisitos', 'fiebre_amarilla_obligatoria', 'fiebre_amarilla_condicional',
  'seguro_obligatorio', 'otro', ''
]);

test('travel-db: estructura general (10 regiones + matrices por region asiatica)', () => {
  // Conteos dinamicos: cada matriz regional suma su archivo (10 regionales +
  // 1 matriz por region con multinacionalidad). Al agregar Excels nuevos no
  // hay que tocar este test.
  const regionales = REGIONES.length;
  assert.ok(db._meta.fuentes.length >= regionales + 4, 'faltan fuentes (regionales + matrices)');
  assert.equal(REGIONES.length, 10);
  assert.ok(MATRICES.length >= 8, `se esperaban >=8 matrices, hay ${MATRICES.length}`);
});

test('travel-db: regionales — pais, iso3 y campos visa/sanidad extraidos', () => {
  let total = 0;
  for (const slug of REGIONES) {
    const region = db.regiones[slug];
    assert.ok(region.archivo, `region ${slug} sin archivo`);
    assert.ok(region.fecha_recopilacion, `region ${slug} sin fecha de recopilacion`);
    assert.ok(Array.isArray(region.paises) && region.paises.length > 0, `region ${slug} sin paises`);
    for (const p of region.paises) {
      total++;
      assert.ok(p.pais && p.pais.trim(), `region ${slug}: pais sin nombre`);
      assert.match(p.iso3, /^[A-Z]{3}$/, `pais ${p.pais}: iso3 invalido "${p.iso3}"`);
      assert.ok(p.visa && typeof p.visa.requisito === 'string', `pais ${p.pais}: visa.requisito faltante`);
      assert.ok(p.visa.requisito.trim(), `pais ${p.pais}: visa.requisito vacio`);
      assert.ok(p.sanidad && typeof p.sanidad.requisito === 'string', `pais ${p.pais}: sanidad.requisito faltante`);
      assert.ok(p.visa.url_oficial === '' || /^https?:\/\//.test(p.visa.url_oficial), `pais ${p.pais}: url visa invalida`);
    }
  }
  assert.equal(total, 144, `se esperaban 144 paises regionales, hay ${total}`);
});

test('travel-db: TODAS las nacionalidades x TODOS los destinos de las matrices', () => {
  // El corazon del test pedido: recorrer los 71 destinos x 21 nacionalidades
  // (1491 celdas) y verificar que cada una extraiga visa y sanidad del JSON.
  const nacionalidadesEsperadas = [
    'Argentina', 'UE / EEE', 'Brasil', 'Chile', 'Uruguay', 'Paraguay', 'Bolivia',
    'Colombia', 'Peru', 'Venezuela', 'Ecuador', 'Mexico', 'Guatemala', 'Honduras',
    'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Belice', 'Estados Unidos', 'Canada'
  ];
  let totalDestinos = 0;
  let totalCeldas = 0;
  const faltantes = [];
  const vacias = [];

  for (const [slug, matriz] of MATRICES) {
    assert.ok(matriz.archivo, `matriz ${slug} sin archivo`);
    assert.ok(Array.isArray(matriz.nacionalidades) && matriz.nacionalidades.length === 21,
      `matriz ${slug}: se esperaban 21 nacionalidades, hay ${matriz.nacionalidades?.length}`);
    assert.deepEqual(
      [...matriz.nacionalidades].sort(), [...nacionalidadesEsperadas].sort(),
      `matriz ${slug}: columnas de nacionalidad inesperadas`
    );
    assert.ok(Array.isArray(matriz.destinos) && matriz.destinos.length > 0, `matriz ${slug} sin destinos`);

    for (const d of matriz.destinos) {
      totalDestinos++;
      assert.ok(d.pais && d.pais.trim(), `matriz ${slug}: destino sin nombre`);
      assert.match(d.iso3, /^[A-Z]{3}$/, `destino ${d.pais}: iso3 invalido "${d.iso3}"`);

      for (const nat of matriz.nacionalidades) {
        totalCeldas++;
        const celda = d.por_nacionalidad[nat];
        if (!celda) { faltantes.push(`${slug}/${d.pais}/${nat}`); continue; }
        if (!celda.visa || !celda.visa.trim()) vacias.push(`${slug}/${d.pais}/${nat} (visa)`);
        if (celda.visa && /^VISADO\s*:/i.test(celda.visa)) vacias.push(`${slug}/${d.pais}/${nat} (prefijo VISADO sin separar)`);
        if (celda.sanidad && /^SANIDAD\s*:/i.test(celda.sanidad)) vacias.push(`${slug}/${d.pais}/${nat} (prefijo SANIDAD sin separar)`);
      }
    }
  }

  assert.ok(totalDestinos >= 123, `se esperaban >=123 destinos, hay ${totalDestinos}`);
  assert.ok(totalCeldas >= 2583, `se esperaban >=2583 celdas (123 destinos x 21), se recorrieron ${totalCeldas}`);
  assert.deepEqual(faltantes, [], `celdas faltantes: ${faltantes.slice(0, 10).join('; ')}`);
  assert.deepEqual(vacias, [], `celdas mal extraidas: ${vacias.slice(0, 10).join('; ')}`);
});

test('travel-db: normalizacion (columna Argentina) con enums validos', () => {
  for (const slug of REGIONES) {
    for (const p of db.regiones[slug].paises) {
      assert.ok(REGIMENES.has(p.normalizado.regimen),
        `region ${slug}/${p.pais}: regimen invalido "${p.normalizado.regimen}"`);
      assert.ok(SANIDADES.has(p.normalizado.sanidad),
        `region ${slug}/${p.pais}: sanidad invalida "${p.normalizado.sanidad}"`);
    }
  }
  for (const [, matriz] of MATRICES) {
    for (const d of matriz.destinos) {
      assert.ok(REGIMENES.has(d.normalizado_arg.regimen),
        `matriz/${d.pais}: regimen invalido "${d.normalizado_arg.regimen}"`);
      assert.ok(SANIDADES.has(d.normalizado_arg.sanidad),
        `matriz/${d.pais}: sanidad invalida "${d.normalizado_arg.sanidad}"`);
    }
  }
});

test('travel-db: Aruba exige fiebre amarilla por pais de salida, no por el pasaporte', () => {
  let aruba;
  for (const [, matriz] of MATRICES) {
    aruba = matriz.destinos.find(d => d.iso3 === 'ABW');
    if (aruba) break;
  }
  assert.ok(aruba, 'Aruba no esta en las matrices');
  const exige = ['Brasil', 'Paraguay', 'Bolivia', 'Colombia', 'Peru', 'Venezuela', 'Ecuador', 'Panama'];
  const noExige = ['Argentina', 'UE / EEE', 'Chile', 'Uruguay', 'Mexico', 'Guatemala', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Belice', 'Estados Unidos', 'Canada'];
  for (const nat of exige) {
    assert.equal(aruba.normalizado[nat].sanidad, 'fiebre_amarilla_obligatoria', nat);
  }
  for (const nat of noExige) {
    assert.equal(aruba.normalizado[nat].sanidad, 'sin_requisitos', nat);
  }
  assert.equal(aruba.normalizado.Argentina.regimen, 'exenta');
  assert.equal(aruba.normalizado['Estados Unidos'].regimen, 'exenta');
  assert.equal(aruba.normalizado.Belice.regimen, 'exenta');
  assert.equal(aruba.normalizado.Bolivia.regimen, 'requiere_visa');
  assert.equal(aruba.normalizado.Venezuela.regimen, 'requiere_visa');
  assert.match(aruba.por_nacionalidad.Argentina.sanidad, /1 de febrero de 2019/);
  assert.match(aruba.por_nacionalidad.Paraguay.sanidad, /EXIGIDO/);
});

test('travel-db: una celda que abre con "No obligatoria" no queda exigida', () => {
  let peru;
  for (const [, matriz] of MATRICES) {
    peru = matriz.destinos.find(d => d.iso3 === 'PER');
    if (peru) break;
  }
  assert.ok(peru, 'Peru no esta en las matrices');
  assert.match(peru.por_nacionalidad.Argentina.sanidad, /^No obligatoria\b/i);
  assert.equal(peru.normalizado.Argentina.sanidad, 'fiebre_amarilla_condicional');
});

test('travel-db: Jamaica exige fiebre amarilla a Argentina y no a Chile ni a EE.UU.', () => {
  let jam;
  for (const [, matriz] of MATRICES) {
    jam = matriz.destinos.find(d => d.iso3 === 'JAM');
    if (jam) break;
  }
  assert.ok(jam, 'Jamaica no esta en las matrices');
  assert.equal(jam.normalizado.Argentina.sanidad, 'fiebre_amarilla_obligatoria');
  assert.equal(jam.normalizado.Chile.sanidad, 'sin_requisitos');
  assert.equal(jam.normalizado['Estados Unidos'].sanidad, 'sin_requisitos');
});

test('travel-db: normalizacion de TODAS las nacionalidades con enums validos', () => {
  // Paso 4: cada celda destino x nacionalidad tiene su regimen clasificado.
  let celdas = 0;
  for (const [, matriz] of MATRICES) {
    for (const d of matriz.destinos) {
      assert.ok(d.normalizado && Object.keys(d.normalizado).length === matriz.nacionalidades.length,
        `matriz/${d.pais}: falta normalizado para alguna nacionalidad`);
      for (const [nat, n] of Object.entries(d.normalizado)) {
        celdas++;
        assert.ok(REGIMENES.has(n.regimen), `matriz/${d.pais}/${nat}: regimen invalido "${n.regimen}"`);
        assert.ok(SANIDADES.has(n.sanidad), `matriz/${d.pais}/${nat}: sanidad invalida "${n.sanidad}"`);
      }
    }
  }
  assert.ok(celdas >= 2583, `se esperaban >=2583 celdas clasificadas, hay ${celdas}`);
  // La cobertura debe ser alta: pocos desconocidos fuera de la columna Argentina.
  const desconocidos = [];
  for (const [, matriz] of MATRICES) {
    for (const d of matriz.destinos) {
      for (const [nat, n] of Object.entries(d.normalizado)) {
        if (nat !== 'Argentina' && (!n.regimen || n.regimen === 'desconocido')) {
          desconocidos.push(`${d.pais}/${nat}`);
        }
      }
    }
  }
  assert.ok(desconocidos.length <= 30,
    `demasiados regimenes desconocidos (${desconocidos.length}): ${desconocidos.slice(0, 8).join('; ')}`);
});

test('travel-db: cobertura completa de clasificacion (sin desconocidos)', () => {
  const residuales = db._meta.normalizacion.residuales || [];
  assert.deepEqual(residuales, [], `paises sin clasificar: ${residuales.join('; ')}`);
});

test('travel-db: alertas de viaje solo donde corresponde', () => {
  const conAlerta = [];
  for (const slug of REGIONES) {
    for (const p of db.regiones[slug].paises) if (p.alerta_viaje) conAlerta.push(p.pais);
  }
  for (const [, matriz] of MATRICES) {
    for (const d of matriz.destinos) if (d.alerta_viaje) conAlerta.push(d.pais);
  }
  // El sufijo de alerta de viaje es el marcado sistematico del dueno para paises
  // en guerra/conflicto o con zonas de riesgo (Medio Oriente, Sahel, Africa, etc).
  // Spot-checks en vez de allowlist cerrada: la lista crece con cada Excel.
  assert.ok(conAlerta.length >= 40, `se esperaban >=40 paises con alerta de viaje, hay ${conAlerta.length}`);
  assert.ok(conAlerta.some(p => /ucrania/i.test(p)), 'falta Ucrania');
  assert.ok(conAlerta.some(p => /libia/i.test(p)), 'falta Libia');
  assert.ok(conAlerta.some(p => /papas?ua|pap[uú]a/i.test(p) || /papua/i.test(p)), 'falta Papua');
});
