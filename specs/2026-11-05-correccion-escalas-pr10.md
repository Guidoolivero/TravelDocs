# Estadias y llegada al dia siguiente en requisitos sanitarios

Estado: implementado y tests verificados; reindexacion final pendiente
Rama: codex/corregir-escalas-pr10 (local, desde PR #10, 2522e79)

## Problema y pedido

Aplicar los dos arreglos de la revision privada de la PR #10. Un destino
intermedio puede perder su condicion de estadia por compartir aeropuerto con
el vuelo siguiente. El desplazamiento de llegada +1 se pierde al sanear los
segmentos y no participa del calculo de duracion de la conexion.

## Comportamiento y alcance

Un punto de ruta identificado como destino cuenta como estadia. Las escalas
comerciales y paradas tecnicas conservan la politica de transito existente.
El campo mas_dias se conserva en el backend y desplaza la llegada cuando no
hay fecha_llegada explicita. Una fecha de llegada explicita tiene prioridad.
No cambiar las matrices sanitarias, reglas por pais ni strings SSR/FOID.
Los cambios quedan locales, sin push, comentarios externos ni deploy.

## Criterios de aceptacion

- CA-1: SCL-GRU, estadia en Brasil y GRU-AUA conserva Brasil como procedencia
  sanitaria aunque ambos vuelos usen GRU.
- CA-2: un transito comercial sigue usando el umbral o exencion del destino.
- CA-3: un vuelo del 20FEB con llegada 03:00 +1 y salida 21FEB 04:00 produce
  una conexion de 60 minutos y no activa el umbral de mas de 12 horas.
- CA-4: el saneamiento del backend conserva mas_dias; el calculo respeta
  cambios de mes/anio y no suma dos veces una fecha_llegada explicita.

## Plan minimo

1. Agregar la regresion de estadia a tests/fiebre-transito.test.mjs, observar
   el fallo y corregir ctxDeRuta en lib/travel-matriz.mjs.
2. Agregar la regresion de llegada +1, observar el fallo y corregir el
   saneamiento de gemini-travel.cjs y minutosConexion de lib/fiebre-transito.mjs.
3. Ejecutar los tests afectados y npm test; revisar el diff con Ponytail y
   los criterios estructurales de untangle-codebase; reindexar el grafo.

## Verificacion y revision

- CA-1: el test de estadia SCL-GRU-AUA fallo primero con obligatorio=false.
  Tras corregir ctxDeRuta, pasa con obligatorio=true y procedencia Brasil.
- CA-2: los tests de transito conservan los umbrales por destino. La fixture
  de conexion en Lima de tests/travel-reqs.test.mjs ahora usa escala_comercial;
  mantiene la comprobacion de que no exige certificado para Aruba. El caso
  marcado destino en fiebre-transito.test.mjs conserva Brasil como estadia.
- CA-3: el test parser GDS -> handler gemini-travel fallo primero con
  obligatorio=true. Ahora devuelve obligatorio=false y una conexion de 1 hora.
  Solo Firebase, observabilidad y Gemini se simulan; el calculo sanitario es real.
- CA-4: pasan cambios de febrero a marzo, febrero bisiesto, diciembre a enero
  sin anio, +2 con anio explicito, prioridad de fecha_llegada y desplazamientos
  cero o invalidos. El test del handler cubre el saneamiento de mas_dias.
- npm test: 476 tests pasan, cero fallos. git diff --check: sin errores.
- Revision Ponytail y estructural limitada al diff: se elimina la inferencia
  de estadia por coincidencia de aeropuerto y se conserva el calculo de fechas
  en minutosConexion. Sin dependencias nuevas, wrappers ni duplicacion de fechas.
  El campo mas_dias ya existe en el parser; no requiere cambiar esa interfaz.
- El grafo se indexo al abrir la rama. La reindexacion final fallo con
  Transport closed; tambien fallaron las ultimas consultas del grafo.
- Prosa revisada con Humanizer. No se tocaron matrices, reglas sanitarias por
  pais, autenticacion ni datos reales. Sin comprobacion en produccion ni browser.

## Pendientes

Reindexar cuando el servidor codebase-memory vuelva a estar disponible.
La publicacion queda fuera del pedido: sin push ni deploy.
