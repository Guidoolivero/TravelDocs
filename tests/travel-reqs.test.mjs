import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planTravelStopView, splitTravelReqs, injectKnownForms, injectKnownAlerts, dedupeTravelReqs, sameVisa, isSchengenVisa, flagUnverifiedRoute, paradasVisibles } from '../public/js/travel-reqs.mjs';
import { injectMatrizVisas, injectMatrizSanidad } from '../lib/travel-matriz.mjs';

describe('splitTravelReqs', () => {
  it('separa PLF/tasas de salud', () => {
    const { migratorios, salud } = splitTravelReqs([
      { categoria: 'PLF', nombre: 'ED Card' },
      { categoria: 'seguro_medico', nombre: 'Seguro' },
      { categoria: 'otro', nombre: 'Sustainability Fee' }
    ]);
    assert.equal(migratorios.length, 2);
    assert.equal(salud.length, 1);
    assert.equal(salud[0].nombre, 'Seguro');
  });

  it('trata categoria vacia como migratorio', () => {
    const { migratorios, salud } = splitTravelReqs([{ nombre: 'Formulario C5' }]);
    assert.equal(migratorios.length, 1);
    assert.equal(salud.length, 0);
  });
});

describe('planTravelStopView', () => {
  it('Aruba visa-free: muestra ED Card unificada, no tapa con libre de visa', () => {
    const stop = {
      pais: 'Aruba',
      pais_codigo: 'ABW',
      aeropuerto_iata: 'AUA',
      tipo: 'destino',
      libre_ingreso: true,
      requisitos: [
        { categoria: 'PLF', nombre: 'Aruba ED Card (Embarkation/Disembarkation Card)' }
      ]
    };
    const view = planTravelStopView(stop);
    assert.equal(view.showLibreBanner, true);
    assert.equal(view.showMigratorioCards, true);
    assert.equal(view.showEmptyState, false);
    assert.equal(view.showHealthSection, true);
    assert.equal(view.migratorios.length, 1);
    assert.ok(/ED Card/i.test(view.migratorios[0].nombre));
  });

  it('Jamaica visa-free: muestra Formulario C5', () => {
    const view = planTravelStopView({
      pais: 'Jamaica',
      pais_codigo: 'JAM',
      aeropuerto_iata: 'MBJ',
      tipo: 'destino',
      libre_ingreso: true,
      requisitos: [
        { categoria: 'PLF', nombre: 'Formulario C5 (Declaracion de Inmigracion y Aduanas)' }
      ]
    });
    assert.equal(view.showLibreBanner, true);
    assert.equal(view.showMigratorioCards, true);
    assert.equal(view.showHealthSection, true);
    assert.equal(view.migratorios[0].nombre.includes('C5'), true);
  });

  it('libre de visa sin requisitos: solo banner, sin empty state', () => {
    const view = planTravelStopView({
      libre_ingreso: true,
      requisitos: []
    });
    assert.equal(view.showLibreBanner, true);
    assert.equal(view.showMigratorioCards, false);
    assert.equal(view.showEmptyState, false);
    assert.equal(view.showHealthSection, false);
  });

  it('sin visa y sin requisitos: empty state', () => {
    const view = planTravelStopView({
      libre_ingreso: false,
      requisitos: []
    });
    assert.equal(view.showEmptyState, true);
    assert.equal(view.showMigratorioCards, false);
    assert.equal(view.showLibreBanner, false);
  });

  it('visa requerida: tarjetas sin banner de libre ingreso', () => {
    const view = planTravelStopView({
      libre_ingreso: false,
      requisitos: [{ categoria: 'visa', nombre: 'Visa de turismo' }]
    });
    assert.equal(view.showLibreBanner, false);
    assert.equal(view.showMigratorioCards, true);
    assert.equal(view.showHealthSection, true);
  });
});

describe('injectKnownForms', () => {
  const sameUrl = 'https://edcardaruba.aw/welcome';

  it('Aruba: une 2 ED Card + tasa (mismo link) en 1 tarjeta y deja el seguro', () => {
    const data = {
      ruta: [{
        pais: 'Aruba',
        pais_codigo: 'ABW',
        aeropuerto_iata: 'AUA',
        tipo: 'destino',
        requisitos: [
          { categoria: 'PLF', nombre: 'ED Card (Embarkation-Disembarkation Card)', url_oficial: sameUrl },
          { categoria: 'PLF', nombre: 'Aruba ED Card (Embarkation/Disembarkation Card)', url_oficial: sameUrl },
          { categoria: 'otro', nombre: 'Sustainability Fee', url_oficial: sameUrl },
          { categoria: 'seguro_medico', nombre: 'Seguro de Viaje (Visitor Insurance)', url_oficial: 'https://www.visitaruba.com/insurance' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    const eds = reqs.filter(r => /ED Card/i.test(r.nombre));
    const fees = reqs.filter(r => /Sustainability|Sostenib/i.test(r.nombre) && !/ED Card/i.test(r.nombre));
    assert.equal(eds.length, 1);
    assert.equal(fees.length, 0);
    assert.equal(reqs.filter(r => /Seguro/i.test(r.nombre)).length, 1);
    assert.equal(eds[0].url_oficial, 'https://edcardaruba.aw/welcome');
    assert.match(eds[0].costo_aproximado, /USD 20/);
  });

  it('Aruba: une por URL aunque el nombre no diga ED Card', () => {
    const data = {
      ruta: [{
        pais: 'Aruba',
        pais_codigo: 'ABW',
        aeropuerto_iata: 'AUA',
        tipo: 'destino',
        requisitos: [
          { categoria: 'otro', nombre: 'Formulario de inmigracion', url_oficial: 'https://www.edcardaruba.aw/welcome' },
          { categoria: 'otro', nombre: 'Tasa ambiental', url_oficial: 'http://edcardaruba.aw/' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    // Los 2 reqs de entrada (misma URL ED Card) se unifican en 1 sola tarjeta ED Card.
    assert.equal(reqs.filter(r => /ED Card/i.test(r.nombre)).length, 1, 'los 2 reqs con misma URL se unifican en 1 ED Card');
    assert.equal(reqs.filter(r => /Formulario de inmigracion|Tasa ambiental/i.test(r.nombre)).length, 0, 'los nombres originales se reemplazan por ED Card');
    // Fix C: Aruba tambien inyecta el corrector de fiebre amarilla condicional.
    assert.ok(reqs.find(r => /fiebre amarilla/i.test(r.nombre)), 'esta el corrector de fiebre amarilla de Aruba');
  });

  it('Jamaica: deja un solo C5 si Gemini mando dos', () => {
    const data = {
      ruta: [{
        pais: 'Jamaica',
        pais_codigo: 'JAM',
        aeropuerto_iata: 'MBJ',
        tipo: 'destino',
        requisitos: [
          { categoria: 'PLF', nombre: 'Formulario C5', url_oficial: 'https://www.enterjamaica.gov.jm/' },
          { categoria: 'PLF', nombre: 'C5 Immigration and Customs', url_oficial: 'https://enterjamaica.gov.jm/' }
        ]
      }]
    };
    injectKnownForms(data);
    assert.equal(data.ruta[0].requisitos.length, 1);
    assert.match(data.ruta[0].requisitos[0].nombre, /C5/);
  });

  it('China (PVG): inyecta la Tarjeta de Llegada digital si Gemini la omite', () => {
    const data = {
      ruta: [{
        pais: 'China',
        pais_codigo: 'CHN',
        aeropuerto_iata: 'PVG',
        tipo: 'destino',
        requisitos: [{ categoria: 'visado', nombre: 'Visa de turista L' }]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    const card = reqs.find(r => /Tarjeta de Llegada/i.test(r.nombre));
    assert.ok(card, 'la tarjeta de llegada se inyecto');
    assert.equal(card.url_oficial, 'https://s.nia.gov.cn/ArrivalCardFillingPC/');
    assert.equal(card.costo_aproximado, 'Gratuito');
    assert.equal(reqs.filter(r => /Tarjeta de Llegada/i.test(r.nombre)).length, 1);
    assert.ok(reqs.find(r => /Visa de turista/i.test(r.nombre)), 'no pisa los otros requisitos');
  });

  it('China: reemplaza la variante del modelo (Digital Arrival Card) por la canonica', () => {
    const data = {
      ruta: [{
        pais: 'China',
        pais_codigo: 'CHN',
        aeropuerto_iata: 'PVG',
        tipo: 'destino',
        requisitos: [
          { categoria: 'PLF', nombre: 'China Digital Arrival Card', url_oficial: 'https://s.nia.gov.cn/ArrivalCardFillingPC/' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    // 2 tarjetas canonicas: la de llegada (reemplaza la del modelo) + la
    // Declaracion de Salud de Aduanas (recomendada, universal).
    const llegada = reqs.filter(r => /arrival|tarjeta de llegada/i.test(r.nombre));
    assert.equal(llegada.length, 1, 'queda una sola tarjeta de llegada');
    assert.match(llegada[0].nombre, /Tarjeta de Llegada a China/);
    assert.equal(llegada[0].verificado_web, true);
  });

  it('China: NO inyecta la tarjeta en parada tecnica (tránsito sin desembarcar)', () => {
    const data = {
      ruta: [{
        pais: 'China',
        pais_codigo: 'CHN',
        aeropuerto_iata: 'PVG',
        tipo: 'parada_tecnica',
        requisitos: []
      }]
    };
    injectKnownForms(data);
    assert.equal(data.ruta[0].requisitos.length, 0);
  });

  it('China: Declaracion de Salud de Aduanas inyectada como RECOMENDADA (universal, dedup)', () => {
    // Desde 1/11/2023 solo es obligatoria con sintomas: voluntaria para la mayoria.
    // El modelo suele traerla como obligatoria: el sameAs la reemplaza por la canonica.
    const data = {
      ruta: [{
        pais: 'China',
        pais_codigo: 'CHN',
        aeropuerto_iata: 'PVG',
        tipo: 'destino',
        requisitos: [
          { categoria: 'declaracion_salud', nombre: 'Declaración de Salud de Aduanas (obligatoria)', obligatorio: true }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    const decl = reqs.filter(r => /declaraci/i.test(r.nombre));
    assert.equal(decl.length, 1, 'una sola tarjeta de declaracion de salud');
    assert.equal(decl[0].obligatorio, false, 'queda como RECOMENDADA');
    assert.equal(decl[0].url_oficial, 'https://htdecl.customs.gov.cn/');
    assert.equal(decl[0].verificado_web, true);
    // La tarjeta de llegada sigue presente.
    assert.ok(reqs.some(r => /Tarjeta de Llegada/i.test(r.nombre)));
  });

  it('Cuba: reemplaza Tarjeta de Turista (obsoleta) y e-Visa del modelo por la e-Visa canonica', () => {
    // Desde 01/07/2025 el tramite es 100% electronico (evisacuba.cu). Si Gemini
    // trae cualquiera de las dos variantes, queda una sola tarjeta canonica.
    const data = {
      ruta: [{
        pais: 'Cuba',
        pais_codigo: 'CUB',
        aeropuerto_iata: 'HAV',
        tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'Tarjeta de Turista', url_oficial: 'https://misiones.cubaminrex.cu/es/argentina/servicios-consulares' },
          { categoria: 'visado', nombre: 'e-Visa de turismo (evisacuba.cu)', url_oficial: 'https://evisacuba.cu/' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    const visas = reqs.filter(r => /tarjeta de turista|e-?visa/i.test(r.nombre));
    assert.equal(visas.length, 1, 'queda una sola tarjeta de visa');
    assert.match(visas[0].nombre, /e-Visa de turismo/);
    assert.equal(visas[0].url_oficial, 'https://evisacuba.cu/');
    assert.equal(visas[0].verificado_web, true);
  });

  it('no toca un destino sin requisitos canonicos ni duplicados', () => {
    // Marruecos esta en PAISES_CONOCIDOS con reqs: [] (conocido, sin inyeccion).
    // injectKnownForms no debe agregar ni quitar nada.
    const data = {
      ruta: [{
        pais: 'Marruecos',
        pais_codigo: 'MAR',
        aeropuerto_iata: 'CMN',
        tipo: 'destino',
        requisitos: [{ categoria: 'otro', nombre: 'Tasa aeroportuaria' }]
      }]
    };
    injectKnownForms(data);
    assert.equal(data.ruta[0].requisitos.length, 1);
    assert.equal(data.ruta[0].requisitos[0].nombre, 'Tasa aeroportuaria');
  });

  it('España (Schengen): reemplaza alucinacion ETIAS por corrector "no requiere visa"', () => {
    // Gemini puede alucinar que ETIAS es obligatorio. El corrector Schengen
    // (sameAs /etias|schengen|visa/) lo reemplaza por la version verificada.
    const data = {
      ruta: [{
        pais: 'España',
        pais_codigo: 'ESP',
        aeropuerto_iata: 'MAD',
        tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'ETIAS obligatorio para ingresar a Schengen', url_oficial: 'https://travel-europa.example/etias' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 1, 'la alucinacion ETIAS se reemplaza por el corrector');
    assert.match(reqs[0].nombre, /no requiere visa|exenta/i);
    assert.equal(reqs[0].verificado_web, true);
    assert.equal(reqs[0].obligatorio, false);
  });

  it('USA: reemplaza alucinacion ESTA por visa B1/B2 (Argentina no es VWP)', () => {
    // Argentinos no usan ESTA (Argentina fuera del Visa Waiver Program).
    // El corrector (sameAs ...|esta) reemplaza la alucinacion por B1/B2.
    const data = {
      ruta: [{
        pais: 'Estados Unidos', pais_codigo: 'USA', aeropuerto_iata: 'MIA', tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'ESTA (Electronic System for Travel Authorization)', url_oficial: 'https://esta.cbp.example.gov/' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 1, 'la alucinacion ESTA se reemplaza por B1/B2');
    assert.match(reqs[0].nombre, /B1\/B2|no visa de turismo/i);
    assert.equal(reqs[0].verificado_web, true);
    assert.equal(reqs[0].obligatorio, true);
  });

  it('Canada: reemplaza alucinacion eTA por visa TRV', () => {
    const data = {
      ruta: [{
        pais: 'Canada', pais_codigo: 'CAN', aeropuerto_iata: 'YYZ', tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'eTA Canada (electronic Travel Authorization)', url_oficial: 'https://canada.example/eta' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 1, 'la alucinacion eTA se reemplaza por TRV');
    assert.match(reqs[0].nombre, /TRV|visitante tradicional/i);
    assert.equal(reqs[0].verificado_web, true);
  });

  it('Australia: reemplaza alucinacion eVisitor/ETA por Visitor visa 600 (+ nota fiebre amarilla)', () => {
    const data = {
      ruta: [{
        pais: 'Australia', pais_codigo: 'AUS', aeropuerto_iata: 'SYD', tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'eVisitor Australia / ETA subclass 601', url_oficial: 'https://au.example/eta' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    // Australia tiene 2 correctores: visado (Visitor 600) + vacuna (fiebre amarilla condicional).
    assert.equal(reqs.length, 2, 'la alucinacion se reemplaza por Visitor 600 + nota fiebre amarilla');
    assert.ok(reqs.every(r => r.verificado_web === true), 'todos los correctores quedan verificado_web');
    const visado = reqs.find(r => /subclass 600|visitor visa/i.test(r.nombre));
    assert.ok(visado, 'esta el corrector Visitor visa 600');
    assert.equal(visado.obligatorio, true);
  });

  it('Costa Rica: fiebre amarilla condicional (no obligatoria para vuelo directo AR)', () => {
    // Correccion del RTF "Datos Extras": Argentina no esta en la lista de
    // riesgo de Costa Rica. El corrector queda obligatorio:false (condicional).
    const data = {
      ruta: [{
        pais: 'Costa Rica', pais_codigo: 'CRI', aeropuerto_iata: 'SJO', tipo: 'destino',
        requisitos: [
          { categoria: 'vacuna', nombre: 'Vacuna fiebre amarilla obligatoria', url_oficial: 'https://cr.example/fa' }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 1, 'la alucinacion "obligatoria" se reemplaza por la condicional');
    assert.equal(reqs[0].obligatorio, false, 'no es obligatoria para vuelo directo desde Argentina');
    assert.match(reqs[0].nombre, /fiebre amarilla/i);
    assert.equal(reqs[0].verificado_web, true);
  });

  it('PUJ: une 2 e-Ticket (mismo link, palabras en otro orden) en 1 tarjeta', () => {
    const url = 'https://eticket.migracion.gob.do/';
    const data = {
      ruta: [{
        pais: 'Republica Dominicana',
        pais_codigo: 'DOM',
        aeropuerto_iata: 'PUJ',
        tipo: 'destino',
        requisitos: [
          { categoria: 'PLF', nombre: 'e-Ticket (Declaración Jurada de Aduanas, Migración y Salud)', url_oficial: url },
          { categoria: 'PLF', nombre: 'E-Ticket (Declaración Jurada de Salud, Aduanas y Migración)', url_oficial: url }
        ]
      }]
    };
    injectKnownForms(data);
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 1);
    assert.match(reqs[0].nombre, /E-Ticket/i);
    assert.match(reqs[0].url_oficial, /eticket\.migracion\.gob\.do/);
  });

  it('nacionalidad no-argentina: NO inyecta (deja el req de Gemini intacto)', () => {
    // PAISES_CONOCIDOS es argentine-only. Para un pasajero indio hacia España
    // (Schengen), el corrector "Argentina exenta" NO aplica: la India SI necesita
    // visa Schengen. El guard debe salir sin tocar el output de Gemini.
    const data = {
      ruta: [{
        pais: 'España', pais_codigo: 'ESP', aeropuerto_iata: 'MAD', tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'Visa Schengen para ciudadanos indios', url_oficial: 'https://india.example/schengen' }
        ]
      }]
    };
    injectKnownForms(data, 'India (IND)');
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 1, 'no se inyecta nada: el req de Gemini queda intacto');
    assert.doesNotMatch(reqs[0].nombre, /Argentina exenta/i, 'no se pega el corrector argentino');
    assert.equal(reqs[0].verificado_web, undefined, 'no se marca verificado_web');
    assert.match(reqs[0].nombre, /Visa Schengen/i, 'el req original de Gemini sobrevive');
  });

  it('India: fiebre amarilla OBLIGATORIA para argentinos (criterio amplio, aun con vuelo directo)', () => {
    const data = { ruta: [{ pais: 'India', pais_codigo: 'IND', tipo: 'destino', requisitos: [] }] };
    injectKnownForms(data, 'Argentina (ARG)');
    const fa = data.ruta[0].requisitos.find(r => r.categoria === 'vacuna');
    assert.ok(fa, 'inyecta la vacuna');
    assert.equal(fa.obligatorio, true, 'obligatoria para ARG (antes era condicional)');
  });

  it('Georgia: seguro medico obligatorio desde 1/1/2026 (universal, dedup con variante del modelo)', () => {
    const data = { ruta: [{
      pais: 'Georgia', pais_codigo: 'GEO', tipo: 'destino',
      requisitos: [{ categoria: 'seguro_medico', nombre: 'Seguro médico', obligatorio: false }]
    }]};
    injectKnownForms(data, 'Brasil (BRA)'); // solo_arg false: aplica a toda nacionalidad
    const seguros = data.ruta[0].requisitos.filter(r => r.categoria === 'seguro_medico');
    assert.equal(seguros.length, 1, 'una sola tarjeta');
    assert.equal(seguros[0].obligatorio, true, 'queda como obligatoria');
    assert.match(seguros[0].descripcion, /1\/1\/2026/);
    assert.match(seguros[0].descripcion, /11\.000/);
  });

  it('nacionalidad argentina: SI inyecta el corrector (explicito y default)', () => {
    // Mismo destino, pasajero argentino: el corrector Schengen aplica.
    // Cubre tanto el valor explicito del select como el default 'ARG' (tests previos).
    const base = {
      ruta: [{
        pais: 'España', pais_codigo: 'ESP', aeropuerto_iata: 'MAD', tipo: 'destino',
        requisitos: [
          { categoria: 'visado', nombre: 'ETIAS obligatorio', url_oficial: 'https://example/etias' }
        ]
      }]
    };
    const dataExplicit = JSON.parse(JSON.stringify(base));
    injectKnownForms(dataExplicit, 'Argentina (ARG)');
    assert.match(dataExplicit.ruta[0].requisitos[0].nombre, /no requiere visa|exenta/i);
    assert.equal(dataExplicit.ruta[0].requisitos[0].verificado_web, true);

    const dataDefault = JSON.parse(JSON.stringify(base));
    injectKnownForms(dataDefault); // sin 2do arg => 'ARG' => inyecta
    assert.match(dataDefault.ruta[0].requisitos[0].nombre, /no requiere visa|exenta/i);
    assert.equal(dataDefault.ruta[0].requisitos[0].verificado_web, true);
  });

  it('no-argentino a España: saca la alucinacion ETIAS (no vigente) sin inyectar "Argentina exenta"', () => {
    // ETIAS no esta vigente (ago 2026) para ninguna nacionalidad. Para un no-argentino
    // el corrector "Argentina exenta" no aplica, pero la alucinacion ETIAS debe sacarse
    // igual: no es requisito accionable.
    const data = {
      ruta: [{
        pais: 'España', pais_codigo: 'ESP', aeropuerto_iata: 'MAD', tipo: 'destino',
        requisitos: [
          { categoria: 'otro', nombre: 'ETIAS (Sistema Europeo de Información y Autorización de Viajes)', url_oficial: 'https://travel-europe.europa.eu/etias_en', obligatorio: false }
        ]
      }]
    };
    injectKnownForms(data, 'Brasil (BRA)');
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.filter(r => /etias/i.test(r.nombre)).length, 0, 'la alucinacion ETIAS se saca para el brasileño');
    assert.equal(reqs.filter(r => /Argentina exenta/i.test(r.nombre)).length, 0, 'no se inyecta el corrector argentino para un brasileño');
  });

  it('Aruba: reemplaza fiebre amarilla alucinada (obligatoria) por corrector condicional (argentino exento en vuelo directo)', () => {
    // Gemini puede alucinar fiebre amarilla obligatoria para Aruba. El corrector
    // (sameAs /fiebre amarilla|yellow fever/i) la reemplaza por la condicional:
    // argentinos en vuelo directo EZE-AUA estan exentos.
    const data = {
      ruta: [{
        pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino',
        requisitos: [
          { categoria: 'vacuna', nombre: 'Vacuna fiebre amarilla obligatoria', url_oficial: 'https://aruba.example/fa' }
        ]
      }]
    };
    injectKnownForms(data); // default ARG
    const reqs = data.ruta[0].requisitos;
    const fa = reqs.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.ok(fa, 'esta el corrector de fiebre amarilla');
    assert.equal(fa.obligatorio, false, 'es condicional, no obligatoria para vuelo directo EZE-AUA');
    assert.equal(fa.verificado_web, true);
    assert.ok(reqs.find(r => /ED Card/i.test(r.nombre)), 'la ED Card universal sigue presente');
  });

  it('no-argentino a Aruba: inyecta la ED Card universal + fiebre amarilla condicional', () => {
    // ED Card (solo_arg:false) y fiebre amarilla (solo_arg:false, regla por
    // origen/itinerario) son universales: un brasilero las ve garantizadas +
    // verificadas aunque Gemini las omita. (Antes la fiebre amarilla era solo
    // argentina y un brasilero desde zona de riesgo quedaba expuesto.)
    const data = {
      ruta: [{
        pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino',
        requisitos: []
      }]
    };
    injectKnownForms(data, 'Brasil (BRA)');
    const reqs = data.ruta[0].requisitos;
    assert.equal(reqs.length, 2, 'se inyectan ED Card + fiebre amarilla aunque Gemini las omitio');
    const ed = reqs.find(r => /ED Card/i.test(r.nombre));
    const fv = reqs.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.ok(ed, 'inyecta la ED Card universal');
    assert.ok(fv, 'inyecta el corrector de fiebre amarilla (universal, no solo argentino)');
    assert.equal(ed.verificado_web, true);
    assert.equal(fv.obligatorio, false, 'la fiebre amarilla es condicional por origen, no obligatoria');
  });

  it('no-argentino a India: inyecta SOLO Air Suvidha (universal); e-Visa y fiebre amarilla NO', () => {
    // India es MIXTA: e-Visa (default solo_arg:true), Air Suvidha (solo_arg:false),
    // fiebre amarilla (default true, condicional por origen). Para un brasileño
    // solo debe inyectarse Air Suvidha; e-Visa y fiebre amarilla las decide Gemini.
    const data = {
      ruta: [{
        pais: 'India', pais_codigo: 'IND', aeropuerto_iata: 'DEL', tipo: 'destino',
        requisitos: [
          { categoria: 'eVisa', nombre: 'e-Visa para ciudadanos brasileños', url_oficial: 'https://indianvisaonline.gov.in/evisa/tvoa.html' }
        ]
      }]
    };
    injectKnownForms(data, 'Brasil (BRA)');
    const reqs = data.ruta[0].requisitos;
    const airSuvidha = reqs.find(r => /air.?suvidha/i.test(r.nombre));
    assert.ok(airSuvidha, 'Air Suvidha (universal) se inyecta');
    assert.equal(airSuvidha.verificado_web, true);
    const evisa = reqs.find(r => /e.?visa/i.test(r.nombre) && !/air/i.test(r.nombre));
    assert.ok(evisa, 'la e-Visa del modelo sobrevive (no se inyecta la canonica argentine-specific)');
    assert.equal(reqs.filter(r => /fiebre amarilla/i.test(r.nombre)).length, 0, 'no se inyecta la fiebre amarilla canonica (la decide Gemini por itinerario)');
  });
});

// Mismo orden que la pantalla: el servidor inyecta conocidos y despues la matriz,
// y el cliente vuelve a correr injectKnownForms sobre la respuesta.
function pantalla(data, nacionalidad, segmentos) {
  injectKnownForms(data, nacionalidad);
  injectMatrizVisas(data, nacionalidad);
  injectMatrizSanidad(data, nacionalidad, segmentos);
  injectKnownForms(data, nacionalidad);
  return data;
}

describe('paradasVisibles', () => {
  const idaVuelta = [
    { pais_codigo: 'ARG', aeropuerto_iata: 'AEP', tipo: 'origen' },
    { pais_codigo: 'PER', aeropuerto_iata: 'LIM', tipo: 'destino' },
    { pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino' },
    { pais_codigo: 'PER', aeropuerto_iata: 'LIM', tipo: 'destino' },
    { pais_codigo: 'ARG', aeropuerto_iata: 'EZE', tipo: 'destino' },
  ];

  it('no repite Lima ni la vuelta a casa de un argentino', () => {
    assert.deepEqual(paradasVisibles(idaVuelta, 'ARG').map(s => s.aeropuerto_iata), ['AEP', 'LIM', 'AUA']);
  });

  it('deja Ezeiza si el pasajero no es argentino', () => {
    assert.deepEqual(paradasVisibles(idaVuelta, 'USA').map(s => s.aeropuerto_iata), ['AEP', 'LIM', 'AUA', 'EZE']);
  });

  it('un vuelo interno sigue mostrando el aeropuerto de llegada', () => {
    const ruta = [
      { pais_codigo: 'ARG', aeropuerto_iata: 'AEP', tipo: 'origen' },
      { pais_codigo: 'ARG', aeropuerto_iata: 'EZE', tipo: 'destino' },
    ];
    assert.deepEqual(paradasVisibles(ruta, 'ARG').map(s => s.aeropuerto_iata), ['AEP', 'EZE']);
  });
});

describe('pantalla Requisitos de vuelo', () => {
  it('argentino ASU-AUA: sanidad de Paraguay, visa del pasaporte, ED Card', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Paraguay', pais_codigo: 'PRY', aeropuerto_iata: 'ASU', tipo: 'origen', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [
          { categoria: 'vacuna', nombre: 'Vacuna fiebre amarilla obligatoria', url_oficial: 'https://aruba.example/fa' }
        ] }
      ]
    }, 'Argentina (ARG)');
    const reqs = data.ruta[1].requisitos;
    const fa = reqs.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.ok(fa, 'hay tarjeta de fiebre amarilla');
    assert.equal(fa.obligatorio, true);
    assert.match(fa.descripcion, /Sale de Paraguay/);
    assert.match(fa.descripcion, /EXIGIDO/);
    assert.doesNotMatch(fa.descripcion, /1 de febrero de 2019/);
    assert.doesNotMatch(fa.descripcion, /zona de riesgo/);
    assert.ok(reqs.find(r => /ED Card/i.test(r.nombre)), 'la ED Card sigue');
    const visa = reqs.find(r => /visa/i.test(r.nombre));
    assert.match(visa.descripcion, /90 dias en 180/);
  });

  it('argentino EZE-AUA: exencion de Argentina, no la de Paraguay', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Argentina', pais_codigo: 'ARG', aeropuerto_iata: 'EZE', tipo: 'origen', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const fa = data.ruta[1].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(fa.obligatorio, false);
    assert.match(fa.descripcion, /Sale de Argentina/);
    assert.match(fa.descripcion, /1 de febrero de 2019/);
    assert.doesNotMatch(fa.descripcion, /EXIGIDO/);
  });

  it('estadounidense SCL-AUA: sanidad de Chile y visa de Estados Unidos', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Chile', pais_codigo: 'CHL', aeropuerto_iata: 'SCL', tipo: 'origen', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Estados Unidos (USA)');
    const reqs = data.ruta[1].requisitos;
    const fa = reqs.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(fa.obligatorio, false);
    assert.match(fa.descripcion, /Sale de Chile/);
    assert.match(fa.descripcion, /Chile no esta en la lista oficial de Aruba/);
    assert.doesNotMatch(fa.descripcion, /EXIGIDO/);
    const visa = reqs.find(r => /visa/i.test(r.nombre));
    assert.match(visa.descripcion, /180 dias consecutivos en 365/);
  });

  it('LIM desde Argentina: "No obligatoria" no lleva cartel Obligatorio', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Argentina', pais_codigo: 'ARG', aeropuerto_iata: 'AEP', tipo: 'origen', requisitos: [] },
        { pais: 'Peru', pais_codigo: 'PER', aeropuerto_iata: 'LIM', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const fa = data.ruta[1].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(fa.obligatorio, false);
    assert.match(fa.nombre, /Certificado internacional de fiebre amarilla/);
    assert.match(fa.descripcion, /Sale de Argentina/);
    assert.match(fa.descripcion, /No obligatoria/);
  });

  it('escala en Paraguay no cuenta como llegada a Aruba', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Chile', pais_codigo: 'CHL', aeropuerto_iata: 'SCL', tipo: 'origen', requisitos: [] },
        { pais: 'Paraguay', pais_codigo: 'PRY', aeropuerto_iata: 'ASU', tipo: 'escala_comercial', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const fa = data.ruta[2].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(fa.obligatorio, false);
    assert.match(fa.descripcion, /Sale de Chile/);
    assert.doesNotMatch(fa.descripcion, /EXIGIDO/);
  });

  it('estadia en Paraguay si exige el certificado para Aruba', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Chile', pais_codigo: 'CHL', aeropuerto_iata: 'SCL', tipo: 'origen', requisitos: [] },
        { pais: 'Paraguay', pais_codigo: 'PRY', aeropuerto_iata: 'ASU', tipo: 'destino', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const fa = data.ruta[2].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(fa.obligatorio, true);
    assert.match(fa.descripcion, /Sale de Paraguay/);
    assert.match(fa.descripcion, /EXIGIDO/);
  });

  it('conexion el mismo dia en Lima no exige fiebre amarilla para Aruba', () => {
    const segmentos = [
      { origen: 'AEP', destino: 'LIM', fecha: '24DEC26' },
      { origen: 'LIM', destino: 'AUA', fecha: '24DEC26' },
      { origen: 'AUA', destino: 'LIM', fecha: '07JAN27' },
      { origen: 'LIM', destino: 'EZE', fecha: '07JAN27' }
    ];
    const data = pantalla({
      ruta: [
        { pais: 'Argentina', pais_codigo: 'ARG', aeropuerto_iata: 'AEP', tipo: 'origen', requisitos: [] },
        { pais: 'Peru', pais_codigo: 'PER', aeropuerto_iata: 'LIM', tipo: 'destino', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] },
        { pais: 'Peru', pais_codigo: 'PER', aeropuerto_iata: 'LIM', tipo: 'destino', requisitos: [] },
        { pais: 'Argentina', pais_codigo: 'ARG', aeropuerto_iata: 'EZE', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)', segmentos);
    const fa = data.ruta[2].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(data.ruta[1].tipo, 'destino');
    assert.equal(fa.obligatorio, false);
    assert.match(fa.descripcion, /Sale de Argentina/);
    assert.match(fa.descripcion, /1 de febrero de 2019/);
    assert.doesNotMatch(fa.descripcion, /EXIGIDO/);
  });

  it('salida sin columna no afirma la exencion', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Japon', pais_codigo: 'JPN', aeropuerto_iata: 'NRT', tipo: 'origen', requisitos: [] },
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const fa = data.ruta[1].requisitos.find(r => /fiebre|sanidad/i.test(r.nombre + r.descripcion));
    assert.equal(fa.obligatorio, false);
    assert.match(fa.descripcion, /La base no tiene sanidad para la salida desde Japón/);
    assert.doesNotMatch(fa.descripcion, /1 de febrero de 2019/);
    assert.doesNotMatch(fa.descripcion, /No se exige/);
  });

  it('si Gemini no marca el origen, usa el IATA que cargo el agente', () => {
    const data = pantalla({
      vuelo: { origen_iata: 'ASU' },
      ruta: [
        { pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const destino = data.ruta.find(s => s.tipo === 'destino');
    const fa = destino.requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.equal(fa.obligatorio, true);
    assert.match(fa.descripcion, /Sale de Paraguay/);
    assert.match(fa.descripcion, /EXIGIDO/);
  });

  it('la vuelta lee los paises visitados, no el pasaporte', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Países Bajos', pais_codigo: 'NLD', aeropuerto_iata: 'AMS', tipo: 'origen', requisitos: [] },
        { pais: 'España', pais_codigo: 'ESP', aeropuerto_iata: 'BCN', tipo: 'destino', requisitos: [] },
        { pais: 'España', pais_codigo: 'ESP', aeropuerto_iata: 'MAD', tipo: 'destino', requisitos: [] },
        { pais: 'Países Bajos', pais_codigo: 'NLD', aeropuerto_iata: 'AMS', tipo: 'destino', requisitos: [] }
      ]
    }, 'Argentina (ARG)');
    const esp = data.ruta[1].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    const nld = data.ruta[3].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.match(esp.descripcion, /Sale de Países Bajos/);
    assert.match(nld.descripcion, /Sale de España/);
  });

  it('estadounidense SCL-GUA: sanidad de Chile, no la de su pasaporte', () => {
    const data = pantalla({
      ruta: [
        { pais: 'Chile', pais_codigo: 'CHL', aeropuerto_iata: 'SCL', tipo: 'origen', requisitos: [] },
        { pais: 'Guatemala', pais_codigo: 'GTM', aeropuerto_iata: 'GUA', tipo: 'destino', requisitos: [] }
      ]
    }, 'Estados Unidos (USA)');
    const fa = data.ruta[1].requisitos.find(r => /fiebre amarilla/i.test(r.nombre));
    assert.match(fa.descripcion, /Sale de Chile/);
    assert.match(fa.descripcion, /Chile no es pais de riesgo/);
    assert.doesNotMatch(fa.descripcion, /para esta nacionalidad/);
    const visa = data.ruta[1].requisitos.find(r => /visa/i.test(r.nombre));
    assert.match(visa.descripcion, /Categoria A, exenta, 90 dias/);
  });
});

describe('sameVisa', () => {
  // Conservativo: ante la duda NO fusiona (devuelve false). Previene que una
  // tarjeta de visa se pise silenciosamente con la URL/costo de otra visa distinta.

  it('no fusiona visa Schengen Tipo C con visa larga duracion Tipo D', () => {
    assert.equal(sameVisa('Visa Schengen (Tipo C)', 'Visa de larga duración (Tipo D)'), false);
  });

  it('no fusiona visa Schengen Tipo C con visa de transito Tipo A', () => {
    assert.equal(sameVisa('Visa Schengen (Tipo C)', 'Visa de tránsito (Tipo A)'), false);
  });

  it('no fusiona visa Schengen con visa de turismo de otro pais', () => {
    assert.equal(sameVisa('Visa de turismo (Estados Unidos)', 'Visa Schengen (Tipo C)'), false);
  });

  it('no fusiona visa nacional (larga duracion) con visa Schengen', () => {
    assert.equal(sameVisa('Visa nacional (larga duración)', 'Visa Schengen (Tipo C)'), false);
  });

  it('fusiona "Visa Schengen (Tipo C)" con "Visa de corta estancia (Tipo C)"', () => {
    assert.equal(sameVisa('Visa Schengen (Tipo C)', 'Visa de corta estancia (Tipo C)'), true);
  });

  it('fusiona "Visa uniforme" con "Visa Schengen"', () => {
    assert.equal(sameVisa('Visa uniforme', 'Visa Schengen'), true);
  });

  it('fusiona "Visa de breve duracion" con "Visa tipo C"', () => {
    assert.equal(sameVisa('Visa de breve duración', 'Visa tipo C'), true);
  });

  it('isSchengenVisa ignora acentos y puntuacion', () => {
    assert.equal(isSchengenVisa('Visá Schèngën (Tipo C)'), true);
    assert.equal(isSchengenVisa('Visa de Tránsito (Tipo A)'), false);
  });
});

describe('dedupeTravelReqs', () => {
  it('une por URL aunque el destino no tenga regla propia', () => {
    const url = 'https://www.ejemplo.gov/form';
    const out = dedupeTravelReqs([
      { nombre: 'Formulario A', url_oficial: url, descripcion: 'corto' },
      { nombre: 'Formulario A (completo)', url_oficial: 'https://ejemplo.gov/form/', descripcion: 'descripcion mas larga del mismo tramite' }
    ]);
    assert.equal(out.length, 1);
    assert.match(out[0].descripcion, /mas larga/);
  });

  it('une nombres con las mismas palabras en otro orden', () => {
    const out = dedupeTravelReqs([
      { nombre: 'e-Ticket (Declaración Jurada de Aduanas, Migración y Salud)' },
      { nombre: 'E-Ticket (Declaración Jurada de Salud, Aduanas y Migración)' }
    ]);
    assert.equal(out.length, 1);
  });

  it('no une requisitos distintos con URL distinta', () => {
    const out = dedupeTravelReqs([
      { nombre: 'Visa de turismo', url_oficial: 'https://visa.ejemplo.gov' },
      { nombre: 'Seguro medico', url_oficial: 'https://seguro.ejemplo.gov' }
    ]);
    assert.equal(out.length, 2);
  });

  it('une la visa Schengen aunque el modelo y la web la nombren distinto', () => {
    // El modelo arma "Visa Schengen (Tipo C)" con URL de BLS; la verificacion
    // web la devuelve como "Visa de corta estancia (Tipo C)" con URL de
    // exteriores.gob.es. Sin sameVisa quedaban dos tarjetas duplicadas.
    const out = dedupeTravelReqs([
      { nombre: 'Visa Schengen (Tipo C)', url_oficial: 'https://blsgroups.com/visa', descripcion: 'via BLS' },
      { nombre: 'Visa de corta estancia (Tipo C)', url_oficial: 'https://www.exteriores.gob.es/schengen', descripcion: 'fuente oficial verificada en vivo' }
    ]);
    assert.equal(out.length, 1);
    assert.match(out[0].url_oficial, /exteriores/);
  });

  it('no une la visa Schengen con una visa de turismo de otro pais', () => {
    const out = dedupeTravelReqs([
      { nombre: 'Visa Schengen (Tipo C)', url_oficial: 'https://www.exteriores.gob.es/schengen' },
      { nombre: 'Visa de turismo (Estados Unidos)', url_oficial: 'https://travel.state.gov' }
    ]);
    assert.equal(out.length, 2);
  });
});

describe('injectKnownAlerts', () => {
  const alertaRuID = 'Registrar el viaje en la app ruID (recomendado / exigido por la Embajada argentina). Completar al menos 72 horas antes del ingreso.';

  // ruID: registro digital ruso. Para turistas es voluntario por ley, pero la
  // Embajada argentina lo exige. El modelo no lo conoce (post-cutoff): se inyecta
  // como alerta critica flight-level solo para argentinos cuando Rusia esta en ruta.
  it('ARG + destino VKO (Rusia): inyecta el alerta ruID con texto exacto', () => {
    const data = { ruta: [{ pais: 'Rusia', pais_codigo: 'RUS', aeropuerto_iata: 'VKO', tipo: 'destino' }] };
    injectKnownAlerts(data);
    assert.ok(Array.isArray(data.alertas_criticas), 'crea el array alertas_criticas');
    assert.equal(data.alertas_criticas.length, 1);
    assert.equal(data.alertas_criticas[0], alertaRuID);
  });

  it('ARG + ruta sin Rusia: no inyecta el alerta ruID', () => {
    const data = { ruta: [{ pais: 'Aruba', pais_codigo: 'ABW', aeropuerto_iata: 'AUA', tipo: 'destino' }] };
    injectKnownAlerts(data);
    assert.equal((data.alertas_criticas || []).filter(a => /ru.?id/i.test(a)).length, 0);
  });

  it('BRA + destino VKO: no inyecta ruID (gate solo argentinos)', () => {
    // El alerta cita la Embajada argentina: no aplica a otros nacionales.
    const data = { ruta: [{ pais: 'Rusia', pais_codigo: 'RUS', aeropuerto_iata: 'VKO', tipo: 'destino' }] };
    injectKnownAlerts(data, 'Brasil (BRA)');
    assert.equal((data.alertas_criticas || []).filter(a => /ru.?id/i.test(a)).length, 0);
  });

  it('ARG + Rusia por iso3 (pais_codigo=RUS, sin iata ni nombre): matchea', () => {
    const data = { ruta: [{ pais: '', pais_codigo: 'RUS', aeropuerto_iata: '', tipo: 'destino' }] };
    injectKnownAlerts(data);
    assert.equal((data.alertas_criticas || []).filter(a => /ru.?id/i.test(a)).length, 1);
  });

  it('ARG + Rusia por nombre (pais=Rusia, sin iso3 ni iata): matchea', () => {
    const data = { ruta: [{ pais: 'Rusia', pais_codigo: '', aeropuerto_iata: '', tipo: 'destino' }] };
    injectKnownAlerts(data);
    assert.equal((data.alertas_criticas || []).filter(a => /ru.?id/i.test(a)).length, 1);
  });

  it('dedup: si el alerta ruID ya esta, no lo duplica', () => {
    const data = { ruta: [{ pais: 'Rusia', pais_codigo: 'RUS', aeropuerto_iata: 'VKO', tipo: 'destino' }], alertas_criticas: [alertaRuID] };
    injectKnownAlerts(data);
    assert.equal(data.alertas_criticas.length, 1, 'no agrega un segundo alerta ruID');
  });

  // Alertas de seguridad (Excel 21/8): aplican a TODA nacionalidad (solo_arg
  // false) — el riesgo es del destino, no del pasaporte.
  it('Myanmar (MMR): alerta de guerra civil para ARG y para no-ARG', () => {
    for (const nac of ['Argentina (ARG)', 'Brasil (BRA)']) {
      const data = { ruta: [{ pais: 'Myanmar', pais_codigo: 'MMR', tipo: 'destino' }] };
      injectKnownAlerts(data, nac);
      assert.equal((data.alertas_criticas || []).filter(a => /myanmar/i.test(a)).length, 1, `nac=${nac}`);
    }
  });

  it('Medio Oriente: Israel, Libano, Irak, Iran, Siria y Yemen inyectan alerta', () => {
    const casos = [['ISR','Israel'],['LBN','Líbano'],['IRQ','Irak'],['IRN','Irán'],['SYR','Siria'],['YEM','Yemen']];
    for (const [iso, nombre] of casos) {
      const data = { ruta: [{ pais: nombre, pais_codigo: iso, tipo: 'destino' }] };
      injectKnownAlerts(data, 'Argentina (ARG)');
      assert.equal((data.alertas_criticas || []).length, 1, `${nombre} debe tener 1 alerta`);
    }
  });

  it('Jordania: alerta de verificacion urgente antes de vender', () => {
    const data = { ruta: [{ pais: 'Jordania', pais_codigo: 'JOR', tipo: 'destino' }] };
    injectKnownAlerts(data);
    assert.ok(data.alertas_criticas.some(a => /jordania.*verificar/i.test(a)));
  });

  it('Zonas de riesgo puntuales: Tayikistan, Armenia y Azerbaiyan', () => {
    const data = { ruta: [
      { pais: 'Tayikistán', pais_codigo: 'TJK', tipo: 'destino' },
      { pais: 'Armenia', pais_codigo: 'ARM', tipo: 'destino' },
      { pais: 'Azerbaiyán', pais_codigo: 'AZE', tipo: 'destino' }
    ]};
    injectKnownAlerts(data);
    assert.equal(data.alertas_criticas.length, 3);
    assert.ok(data.alertas_criticas.some(a => /pamir/i.test(a)), 'Tayikistan menciona Pamir');
    assert.ok(data.alertas_criticas.some(a => /tatev/i.test(a)), 'Armenia menciona Tatev');
    assert.ok(data.alertas_criticas.some(a => /bakú/i.test(a)), 'Azerbaiyan menciona Baku');
  });

  it('escala_comercial tambien dispara alerta de seguridad (ej. Irak)', () => {
    const data = { ruta: [{ pais: 'Irak', pais_codigo: 'IRQ', tipo: 'escala_comercial' }] };
    injectKnownAlerts(data, 'España (ESP)');
    assert.equal((data.alertas_criticas || []).length, 1, 'universal: tambien para ESP');
  });

  it('ARG + escala_comercial en Rusia (no destino): igual inyecta el alerta', () => {
    const data = { ruta: [{ pais: 'Rusia', pais_codigo: 'RUS', aeropuerto_iata: 'SVO', tipo: 'escala_comercial' }] };
    injectKnownAlerts(data);
    assert.equal((data.alertas_criticas || []).filter(a => /ru.?id/i.test(a)).length, 1);
  });
});

describe('flagUnverifiedRoute', () => {
  it('baja la confianza de alta a baja y agrega alerta al agente', () => {
    const data = { vuelo: { numero: 'JA3795', confianza_ruta: 'alta' }, ruta: [], alertas_criticas: [] };
    flagUnverifiedRoute(data);
    assert.equal(data.vuelo.confianza_ruta, 'baja');
    assert.equal(data.alertas_criticas.length, 1);
    assert.match(data.alertas_criticas[0], /no se pudo verificar/i);
    assert.match(data.alertas_criticas[0], /aerolínea antes de emitir/i);
  });

  it('es idempotente: no duplica la alerta si ya está', () => {
    const data = { vuelo: {}, ruta: [], alertas_criticas: ['No se pudo verificar si este vuelo tiene paradas técnicas o escalas intermedias. Confirmar con la aerolínea antes de emitir.'] };
    flagUnverifiedRoute(data);
    assert.equal(data.alertas_criticas.length, 1);
  });

  it('crea alertas_criticas si no existe y tolera data sin vuelo', () => {
    const data = { ruta: [] };
    flagUnverifiedRoute(data);
    assert.ok(Array.isArray(data.alertas_criticas));
    assert.equal(data.alertas_criticas.length, 1);
  });
});
