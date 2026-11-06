# Resolver conflictos de modularizacion

Estado: verificado localmente; pendiente de comprobacion remota del PR
Rama: codex/modularizacion

## Problema y alcance

El PR 11 reorganiza las funcionalidades y entra en conflicto con las correcciones de escalas del PR 10. Integrar origin/main en esta rama conservando ambos cambios. No fusionar el PR ni desplegar.

## Criterios de aceptacion

- CA-1: las correcciones de horarios, transitos e incertidumbre sanitaria siguen funcionando en las rutas modulares.
- CA-2: editar y guardar una reserva conserva los datos de transito.
- CA-3: pasan los tests unitarios, el build y las comprobaciones locales disponibles; el PR queda actualizado sin conflictos.

## Plan minimo

Resolver imports y scripts, trasladar el parser y las reglas de transito a requisitos, portar los cambios de main a las pantallas y funciones modulares. Verificar consumidores y publicar solo codex/modularizacion.

## Verificacion y revision

Esta spec guia la reconstruccion de la resolucion: el worktree temporal anterior ya no existe.

- CA-1: los tests existentes reprodujeron la perdida de horarios GDS y de transitos PNR antes de portar los cambios. Despues, `npm test`: 484 aprobados, cero fallos.
- CA-2: `tests/agency-ui.smoke.mjs` verifica que editar y guardar conserva un transito de 90 minutos. Paso en Chrome con servicios simulados.
- CA-3 local: build de 62 modulos, smoke de facturacion y MFA aprobados. Bundle de Functions y smoke del paquete PDF aprobados (401 sin credenciales). Sin marcadores de conflicto ni errores de whitespace.
- Revision Ponytail y estructural: se elimino el parser GDS duplicado de la pantalla; parser y politica sanitaria quedan en requisitos. Imports frontend existentes y sin ciclos. Los cuerpos de requisitos-checkin, travel-matriz, gemini-travel y pnr-checkin coinciden con main salvo rutas relativas.
- Los wrappers de Netlify conservan los nombres publicos de endpoints; tienen una razon de compatibilidad y no se eliminan. No se agregaron dependencias, configuracion ni reglas de negocio propias de esta resolucion.

## Limites

No se probaron servicios reales ni produccion. No se repitieron los emuladores de Firestore en esta resolucion; las reglas no cambiaron. La comprobacion remota del PR se realiza despues del push.
