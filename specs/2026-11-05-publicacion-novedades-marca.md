# Publicacion de Novedades y nuevo logo

Estado: implementado y verificado localmente; publicacion en curso
Rama de integracion: codex/novedades-plataforma; destino autorizado: main y produccion

## Pedido y alcance

Publicar las novedades aprobadas, corregir el punto extra del titulo de EEUU, usar el logo de la factura en las pestanas de landing, index y login, y preparar una firma personal con los datos indicados por el usuario. Eliminar solo ramas de Codex ya integradas o descartadas, luego de comprobar su estado.

## Criterios de aceptacion

- CA-1: titulo EE.UU: declaracion jurada por Ebola; lectura reiniciada para la entrega productiva y resto del flujo de novedades conservado.
- CA-2: las tres paginas declaran favicon SVG del monograma TD y fallback PNG; el logo completo coincide con el de la factura.
- CA-3: firma HTML y PNG con los datos proporcionados; los datos personales de la firma quedan fuera de public/ y de Git. El logo puede cargarse desde la web productiva.
- CA-4: integrar el ultimo main, pasar pruebas y esperar el deploy productivo correcto antes de dar la publicacion por terminada.
- CA-5: borrar solo ramas codex/* comprobadas como integradas o descartadas, sin borrar directorios de worktrees, cambios pendientes ni ramas de otras herramientas.

## Plan minimo

1. Integrar origin/main y revisar la diferencia completa de novedades.
2. Corregir titulo y revision; copiar los assets de marca aprobados y agregar los favicons.
3. Renderizar y revisar icono y firma; ejecutar tests y revision estructural del cambio integrado.
4. Integrar a main, esperar CI/deploy y comprobar las paginas y assets publicados.
5. Limpiar referencias de ramas Codex con evidencia de PR integrado/cerrado o ancestry, conservando los worktrees y archivos.

## Verificacion

- Integrado origin/main (74e9f33) antes de la verificacion; se conserva la retencion productiva de versiones del frontend.
- npm test: 469 tests, 0 fallos. npm run build:frontend: correcto.
- PUBLIC_DIR=.netlify/site y XLSX_QA_PATH=/tmp/traveldocs-xlsx-qa.js node tests/agency-ui.smoke.mjs: PASS. node tests/requisitos-email.smoke.mjs: PASS.
- Verificacion estatica: favicons en las tres paginas, monograma PNG de 32x32, SVG y PNG completos identicos al logo de la factura, titulo corregido y revision 2026-11-05-produccion.
- Firma HTML renderizada en Chrome con imagen local equivalente a la URL publica; enlaces de email/telefono y ancho movil verificados. Firma PNG generada. docs/firmas/ esta ignorado por Git y fuera de public/.
- Revision estructural y de seguridad del diff completo: persistencia por agencia y agente conservada, sin nuevos endpoints ni reglas Firebase; assets publicos solo de marca; firma personal fuera del deploy.
- El estado de los PR, las referencias remotas y la limpieza de los worktrees se relevaron antes de cualquier borrado. Ramas Cursor y otras no Codex quedan fuera del alcance.

La evidencia de CI/deploy queda en el workflow Tests del commit integrado a main. La publicacion y la limpieza se confirman al usuario despues de comprobar el resultado remoto. No se instalo la firma en un cliente de correo.
