# Reinicio de lectura y aviso destacado de novedades

Estado: verificado
Rama: codex/novedades-plataforma

## Problema y pedido

Las marcas de lectura de previews anteriores ocultan el aviso al probar una nueva entrega. El usuario pide reiniciarlas para todos los agentes y destacar el texto en mayusculas con el rojo de Vencidos / Criticos.

## Comportamiento y alcance

Publicar una nueva revision del bloque de novedades. Las marcas anteriores quedan conservadas pero no ocultan el aviso de esta revision. Al abrirlo, se guarda la lectura por agente y tarjeta de la revision actual; volver a entrar no lo reactiva por si solo. Al publicar otra revision de novedades en preview, cambiar el identificador de revision del bloque para reiniciar la lectura de esa entrega.

El enlace muestra ULTIMAS NOVEDADES, usa el mismo rojo que el borde del indicador critico y gana tamano, peso, fondo y borde. Mantener pulso, preferencia de movimiento reducido, navegacion al carrusel, flechas y plegado al salir del Dashboard.

La entrega inicial se mantuvo en preview sin borrar documentos de Firebase. La publicacion posterior a main y produccion fue autorizada por el usuario y se registra en specs/2026-11-05-publicacion-novedades-marca.md.

## Criterios de aceptacion

- CA-1: agentes con las tarjetas ya leidas en la version anterior vuelven a ver el aviso.
- CA-2: leer la nueva revision oculta el aviso y conserva ese estado al volver a entrar, sin afectar la lectura de otros agentes.
- CA-3: el texto esta en mayusculas y su color coincide con el indicador critico; el enfasis visual sigue siendo legible en escritorio y celular.
- CA-4: se mantienen el carrusel, el despliegue de detalles y el movimiento reducido.

## Plan minimo

1. Probar el caso con lecturas anteriores de dos usuarios en el navegador simulado y observar el fallo.
2. Agregar la revision a las claves existentes de notificacion, sin cambiar la persistencia ni las reglas de Firebase.
3. Compartir el rojo critico mediante un token y actualizar el enlace y su tarjeta explicativa.
4. Verificar el flujo, el diff, la suite y el preview.

## Verificacion y revision

- CA-1: la prueba de navegador se preparo con lecturas anteriores de dos usuarios. Antes del cambio fallo esperando que apareciera el aviso; despues paso sin eliminar esas marcas.
- CA-2 y CA-4: XLSX_QA_PATH=/tmp/traveldocs-xlsx-qa.js node tests/agency-ui.smoke.mjs. PASS en persistencia tras recarga, independencia entre agentes, reintento ante fallo de guardado, tarjeta nueva, carrusel, despliegue de detalles y movimiento reducido.
- CA-3: la prueba compara el texto en mayusculas y el color calculado del aviso con el borde del indicador critico; verifica texto grande y en negrita. Revision visual en 1440 y 390 px realizada.
- npm test: 468 tests, 0 fallos. npm run build:frontend: correcto. git diff --check: correcto.
- Revision estructural: se reutiliza la persistencia existente; una revision explicita en el bloque controla el reinicio y un token compartido evita duplicar el rojo. Sin refactor general ni cambios a las reglas de acceso.
- sloplint conserva 151 FAIL previos fuera del alcance. Las mayusculas son un pedido expreso del usuario. Su render automatico no corre por falta de puppeteer-core; la revision visual se hizo con Playwright y Chrome.
- Preview publicado: https://novedades-sistema--tradingdocs-staging.netlify.app/ (deploy 6aecd9bdbe9f5f938b71a7a9). Verificados login, revision, enlace en mayusculas, claves de lectura y estilos servidos.

## Limites de la verificacion

No se abrio una sesion real de agente ni se probo Safari en esta entrega. No se borraron documentos de Firebase ni se publico en produccion.
