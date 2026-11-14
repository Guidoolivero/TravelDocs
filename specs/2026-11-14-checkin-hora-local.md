# Horarios locales en check-ins

Estado: verificado localmente; pendiente de revision del PR
Rama: codex/checkin-hora-local

## Alcance
Conservar la salida local del PNR/PDF y mostrarla en reservas, edicion y mails.
Mantener `fecha` en ART para las alertas y consultas existentes; agregar
`fechaLocal` y `zonaHoraria` por tramo. Las reservas previas se interpretan
como ART y se presentan en la zona del origen, sin reescribir datos en masa.
El catalogo IATA determina la zona; Intl aplica las reglas de la fecha.
Los horarios inexistentes o ambiguos por DST no se adivinan.

## Criterios
- DEN 2027-03-07 23:59 se conserva local y equivale a ART 2027-03-08 03:59.
- MIA 2027-03-17 20:15 equivale a ART 21:15.
- Email muestra salida local y fecha/hora ART del check-in segun 24/48/72h.
- Sin zona conocida: conservar dato local y avisar que falta confirmar equivalencia;
  no emitir una alerta calculada con un huso supuesto.
- Editar, guardar, marcar check-in y notificar conservan los metadatos horarios.
- Cliente y cron comparten calculos y presentacion del email.

## Plan y verificacion
Pruebas de conversion, lectura PNR/PDF, mails y compatibilidad primero.
Modulo horario en reservas; consumidores solo adaptan datos. Revisar diff,
ejecutar suite y build, revisar UI con datos ficticios y abrir PR.

## Resultado
- Regresiones ejecutadas en rojo antes de corregir conversion, email y persistencia.
- `npm test`: 507 tests, cero fallos. Frontend y bundle de las dos Functions correctos.
- Chrome local con servicios simulados: fecha local al editar, guardado ART sin
  doble conversion, marca de notificacion conservada y reiniciada al cambiar fecha,
  aeropuerto desconocido conserva la hora local y muestra advertencia.
- Hallmark: inspeccion visual del campo y su etiqueta; sloplint no analiza templates
  dentro de `.mjs`. No se cambiaron estilos globales.
- Ponytail-review del diff y consumidores: corregida perdida de metadatos en altas
  y preservado el instante legacy en horas repetidas por DST. Sin hallazgos pendientes
  que impidan este alcance, para el uso habitual de reservas por agencia.
- Revision estructural: conversion centralizada, sin dependencias nuevas ni ciclos;
  PNR solo adapta extraccion y los consumidores mantienen su responsabilidad.

## Limites
No se enviaron emails reales, no se llamo al modelo real ni se migraron reservas.
La extraccion deterministica cubre las lineas Amadeus del caso reportado; otros
formatos y PDFs siguen usando el modelo con la instruccion de conservar hora local.
Las zonas desconocidas y horas nuevas ambiguas requieren confirmacion antes de
poder calcular una alerta. El catalogo y las reglas IANA deben mantenerse actualizados.
El horario argentino de check-in usa la anticipacion configurada (24/48/72 h),
no consulta la apertura en vivo de cada aerolinea.
