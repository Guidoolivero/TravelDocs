# Arreglos de la auditoria del repo

Estado: implementado, pendiente de merge
Rama: fix/auditoria (PR 19)

Nota: esta spec se escribio durante la revision del PR, no antes de los primeros commits. Registra los criterios con los que se corrigio y verifico el cambio.

## Problema y pedido

El usuario corrio ponytail-audit sobre todo el repo y pidio arreglar los hallazgos en una rama nueva y abrir un PR. La auditoria encontro 20 puntos: XSS en Requisitos, vencimientos mal calculados, facturas trabadas, mails duplicados y escrituras que pisaban cambios de otros agentes, entre otros. El punto 7 (clave privada de EmailJS por agencia) no aplica: todas las agencias usan la misma cuenta.

## Comportamiento y alcance

Se corrigen los 19 puntos restantes sin cambiar formatos SSR/FOID, reglas de Firestore ni el aislamiento entre agencias. Quedan fuera: unificar `parseResTs` con `parseFechaART` (cambia como se leen las fechas), la copia de `initAdmin` en `send-alerts` (su test la carga en un vm) y el campo `memberCount` (lo usan los tests de rules).

## Criterios de aceptacion

- CA-1: un dato con comillas no rompe un atributo HTML (`esc`).
- CA-2: un vencimiento con formato no reconocido queda "Sin datos"; uno que vence hoy da 0 dias.
- CA-3: una factura que fallo antes de reservar en ARCA vuelve a borrador al consultar.
- CA-4: fecha y horas GDS invalidas no llegan al prompt cacheado.
- CA-5: el cron procesa las agencias rotando por hora; un mail unificado fallido no corta la agencia.
- CA-6: guardar un pasajero o un check-in compara y escribe contra el documento del servidor en una transaccion; no se pierden visas, check-ins ni marcas de aviso de otro agente o del cron.
- CA-7: dos navegadores, un doble guardado o el cron y checkin-reqs juntos no mandan el mismo mail dos veces; si el envio del navegador falla, se vuelve a intentar.
- CA-8: errores inesperados de facturacion llegan a Sentry; el historial no corta en 100.
- CA-9: PDF de mas de 4 MB se rechaza con mensaje claro; NM con (CHD) el dia del 2do cumpleanos; cumpleanos descartado no reaparece el 1/1; reporte de uso sin "null%"; panel de check-ins respeta 48/72 hs; 2FA lista mas de 100 miembros.

## Plan minimo

Archivos principales: `public/js/compartido/{ui.mjs,utils.js}`, `public/js/db.js`, `public/js/{pasajeros,reservas,alertas,documentos}/*`, `netlify/functions/lib/{facturacion,alertas,requisitos,administracion}/*`, `netlify/functions/{mfa-admin,mfa-complete,_usage,_sentry}.cjs`. Nuevos: `updatePassengerSiNoCambio`, `updateReservationWith`, `reservarEnvioAlertas`/`liberarEnvioAlertas` en `db.js`; `reservarEnvioRequisitos` en `lib/requisitos/reserva-envio.cjs`.

## Verificacion y revision

- Cada criterio de logica tiene un test que fallo antes del arreglo (`tests/esc`, `alerts`, `auditoria-detalles`, `db-races`, `reservation-view`, `cron-alerts`, `requisitos-checkin`, `travel-cache`, `ssr`, `scanner`, `mfa`, `facturacion/billing-*`).
- Sin test propio: el limite del historial (el fixture no soporta `orderBy`) y la llamada a `checkinAlertDue` en el panel (funcion ya testeada).
- `npm test`: 539 ok. `npm run test:billing:emulator`: 23 ok. `agency-ui.smoke` y `billing-ui.smoke` pasan en local.
- Revision estructural: un solo `initAdmin` (salvo `send-alerts`), se borraron funciones sin uso de `db.js` y re-exports de `billing.cjs`; `updateReservation` quedo sin uso y se borro.
- No probado: navegador real con usuarios, homologacion de ARCA, envios reales de EmailJS.

## Pendientes

- Mergear el PR 19 (publica en produccion).
- `docs/travel-db.json` y `lib/requisitos/matriz.mjs` aparecen regenerados en el working tree por un proceso ajeno a este cambio; no se incluyen.
