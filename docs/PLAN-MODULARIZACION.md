# Plan de modularizacion de TradingDocs

Propuesta del 2026-11-05. Base revisada: main local, commit `cd769f7`.
Rama de trabajo: `codex/modularizacion` (creada originalmente como `codex/plan-modularizacion`). Este documento reemplaza el plan
historico del 2026-10-01. La reorganizacion esta implementada en la rama de trabajo.
Ver [estructura actual](MODULOS.md).

## Alcance

Organizar las funcionalidades en carpetas reconocibles y reducir la cantidad de
lugares que hay que editar para cambiar una funcion del sistema. El primer modulo
sera Facturacion. Los nombres de carpetas seran minusculas y ASCII, por ejemplo
`facturacion/`, para mantener imports consistentes entre macOS y Linux.

El texto siguiente conserva el alcance y los criterios del plan original. La implementacion se realiza en la rama de trabajo,
sin modificar main ni desplegar a produccion durante el trabajo de modularizacion.
No incluye cambios de reglas de negocio, framework, base de datos ni diseno visual.

## Situacion revisada

- `public/js/app.mjs` tiene 5526 lineas. Contiene inicio de sesion, estado de
  pasajeros y reservas, pantallas, administracion y facturacion. Sus handlers usan
  variables compartidas y varios listeners se registran al importar el archivo.
- Ya existen modulos aprovechables: `csv-import.mjs`, `reservation-view.mjs`,
  `billing-form.mjs`, `billing-feedback.mjs`, `scanner.js`, `travel-reqs.mjs` y otros.
  Se conservaran sus reglas y exports durante los movimientos.
- `public/js/db.js` centraliza Firestore y el contexto tenant. No conviene duplicar
  ese contexto al separar pasajeros y reservas.
- Facturacion ya tiene servicio, persistencia, validaciones, auditoria y PDF en
  `netlify/functions/lib/`. La pantalla sigue mezclada con administracion en
  `app.mjs`. `admin-api.cjs` tambien gestiona perfiles de facturacion.
- El frontend se genera desde `public/` hacia `.netlify/site`. El build recorre
  `public/js` de forma recursiva, crea carpetas versionadas y retiene versiones
  anteriores. Las nuevas rutas deben respetar ese mecanismo.
- `scripts/bundle-functions.mjs` descubre entradas `.cjs` directamente dentro de
  `netlify/functions/`. Mover esas entradas a subcarpetas cambiaria el empaquetado.
- Hay tests unitarios, emuladores y smoke tests de navegador. `npm test` enumera
  archivos explicitamente; no cubre por si solo todos los tests existentes.

Estas observaciones corresponden al main local indicado arriba. Antes de implementar
se debe comparar con el main vigente y actualizar el inventario. El indice MCP
excluyo `public/` y `scripts/`; esas partes se revisaron directamente en archivos.

## Estructura propuesta

La misma funcionalidad tendra su carpeta en cada entorno. Solo el codigo de
navegador puede vivir en `public/`. Una carpeta unica con todo el frontend y backend
exigiria cambiar el build y aumentaria el riesgo de publicar archivos privados.

```text
public/
  index.html                      # Conserva el HTML de las vistas al principio
  css/                            # Estilos actuales; separar solo al extraer una vista
  js/
    app.mjs                       # Inicio, sesion, navegacion y coordinacion
    facturacion/                  # Pantalla, formulario, mensajes, visor de PDF
    administracion/               # Agencias, usuarios y reporte de uso
    pasajeros/                    # Lista, detalle, formulario y busqueda
    documentos/                   # Documentos, scanner y strings SSR/FOID
    reservas/                     # Lista, formulario, PNR e itinerarios
    requisitos/                   # Pantalla, analisis y datos publicos generados
    alertas/                      # Reglas, listado y envio fallback del cliente
    importacion/                  # Importador de Excel/CSV y validacion de filas
    ciudades/                     # Catalogo GDS y su pantalla
    compartido/                   # Solo utilidades utilizadas por varios modulos
netlify/
  functions/
    billing-api.cjs                # Entrada HTTP con el nombre actual
    billing-pdf.cjs                # Entrada HTTP con el nombre actual
    admin-api.cjs                  # Conserva sus rutas actuales
    ...                           # Otras entradas y helpers de infraestructura
    lib/
      facturacion/                # Servicio, store, reglas, auditoria y renderer
      administracion/             # Validaciones y logica del panel
      documentos/                 # Extraccion OCR si requiere separar implementacion
      requisitos/                 # Implementacion de requisitos del backend
      alertas/                    # Implementacion de envios programados
lib/                              # Logica backend existente; mover por etapa
scripts/                          # Herramientas de build, generacion y operacion
  facturacion/                    # Scripts propios al migrar el modulo
tests/
  facturacion/                    # Tests y fixtures seguros del modulo
  ...                             # Otras carpetas al migrar cada funcionalidad
docs/
  facturacion/                    # Documentacion operativa propia del modulo
```

El arbol es un destino, no una lista de carpetas vacias a crear. Login, landing,
configuracion Firebase, tenant, telemetria y loader pueden conservar sus entradas
actuales. `compartido/` se forma solo con codigo que ya tenga varios consumidores.
No se agrega un registro de plugins, un bus de eventos ni una capa generica de servicios.

## Responsabilidad y origen de cada modulo

| Modulo | Contenido que se agrupa | Dependencias que conserva |
| --- | --- | --- |
| Facturacion | Bloque billing de `app.mjs`, `billing-form.mjs`, `billing-feedback.mjs`, `billing*.cjs`, `invoice-pdf.cjs`, fuentes y assets privados | Autenticacion de plataforma, perfiles de agencias, transporte HTTP y SDK fiscal actuales |
| Administracion | Pantallas administrativas de `app.mjs`, validadores de admin, operaciones de `admin-api.cjs` | Facturacion para perfiles fiscales y estado; `_usage.cjs` para medicion |
| Pasajeros | Listado, detalle y formulario de `app.mjs`, `passenger-search.mjs`, `pending-passengers.mjs` | Persistencia tenant, documentos, reservas y catalogos |
| Documentos | Pantallas de documentos y OCR, `scanner.js`, `ssr.js`, implementacion de `gemini-scan.cjs` y prompt | Pasajero seleccionado, autenticacion, proveedores IA y medicion |
| Reservas | Secciones de reservas, `reservation-view.mjs`, `parse-pnr-passengers.mjs`, `itinerario-pdf.mjs`, implementacion de `pnr-checkin.cjs` | Pasajeros, ciudades, requisitos y persistencia tenant |
| Requisitos | Pantalla de consulta, `travel-reqs.mjs`, `conocidos.mjs`, implementacion de `gemini-travel.cjs` y `checkin-reqs.cjs`, logica de `lib/` correspondiente | Generadores, cache, nacionalidad, rutas y proveedores IA |
| Alertas | Pantalla, fallback cliente, `alert-core.mjs`, reglas correspondientes de `utils.js`, implementacion de `send-alerts.cjs` | Pasajeros, reservas, configuracion por agencia y marcas de deduplicacion |
| Importacion | Pantalla de importacion y `csv-import.mjs` | Alta de pasajeros y catalogos existentes |
| Ciudades | Pantalla y `gds-cities.mjs` | Persistencia del catalogo GDS |

Catalogos como paises, aerolineas y programas de viajeros frecuentes siguen siendo
compartidos cuando los consumen varios modulos. La medicion de uso es infraestructura;
el reporte pertenece a Administracion. No trasladar todo `_usage.cjs` a Facturacion.

## Interfaces y estado

`app.mjs` inicia la aplicacion y conecta las pantallas. Cada pantalla extraida recibe
solo las dependencias que usa: lectura del estado actual, operaciones de datos,
notificaciones visuales y navegacion. No importa `app.mjs` ni recibe un objeto global
con todas las funciones de la aplicacion.

El estado de formulario, filtros y visor pertenece al modulo de la pantalla.
Pasajeros, reservas y sesion mantienen una unica fuente de verdad. Cuando una pantalla
necesita esos datos, recibe un getter o una actualizacion explicita del coordinador;
no guarda una copia que pueda quedar desactualizada al cambiar de agencia.

Durante la extraccion se conservan los handlers de `window` que usa el HTML actual.
Se registran al inicializar la pantalla, con el DOM disponible. La inicializacion
ocurre una vez; la salida de sesion limpia suscripciones, listeners y URLs de blobs
segun corresponda. Cambiar de vista repetidamente no debe duplicar acciones.

`db.js` conserva inicialmente inicializacion, contexto tenant y suscripciones. Si
luego se separan operaciones por entidad, todas usaran esa misma instancia y contexto.
No se modifica el orden autenticacion -> tenant -> suscripciones.

## Primera migracion: Facturacion

1. Agrupar `billing-form.mjs` y `billing-feedback.mjs` dentro de
   `public/js/facturacion/`, conservando los nombres de archivo y exports. Actualizar
   imports del browser, backend y tests en el mismo cambio. El backend ya consume
   `billing-feedback.mjs`: esa dependencia publica debe seguir siendo pura y sin DOM.
2. Extraer la pantalla billing de `app.mjs` a `facturacion/pantalla.mjs`. Incluye
   listado, vista previa, descarga, confirmacion, recuperacion y reintento. Mantener
   los IDs HTML y los estados fiscales actuales. Incluir listeners que hoy estan
   al final de `app.mjs` y el cierre del dialogo de vista previa.
3. Mantener el formulario de agencia en Administracion. Sus campos fiscales usan
   las funciones de Facturacion; `admin-api.cjs` conserva las transacciones actuales
   entre agencia y perfil fiscal. No repartir esa escritura en dos peticiones.
4. Mover `billing*.cjs`, `invoice-pdf.cjs`, `invoice-fonts/` e `invoice-assets/` de
   `netlify/functions/lib/` a `netlify/functions/lib/facturacion/`. Actualizar todos
   los `require`, rutas de assets e `included_files` de `netlify.toml`. Las entradas
   `billing-api.cjs` y `billing-pdf.cjs` quedan en su ubicacion actual.
5. Agrupar tests y scripts propios. Actualizar rutas relativas, listas de
   `package.json`, workflow y fixtures en el mismo commit que mueve cada archivo.
   Incluir la ruta de `scripts/patch-facturas-quotation.mjs` si se mueve, porque
   `postinstall` depende de ella. No mover documentacion ajena a la funcionalidad.

Cada paso puede ser un commit separado y debe quedar funcionando. No cambiar importes,
redondeos, moneda, periodos, digest, idempotencia, permisos ni recuperacion fiscal.
La comprobacion de emision usa emuladores o servicios simulados, nunca emite una
factura real. Los secretos fiscales permanecen exclusivos del backend.

## Orden y criterios de cierre

| Etapa | Trabajo | Verificacion para cerrarla |
| --- | --- | --- |
| 0 | Registrar baseline de tests y mapa de imports, handlers, estado, rutas y assets de la funcionalidad elegida | Fallos previos separados de regresiones; alcance del commit definido |
| 1 | Facturacion, en los pasos anteriores | Unitarios billing, emulador billing, smoke UI, PDF y paquete desplegable sin servicios reales |
| 2 | Importacion y Ciudades | Importar filas validas/invalidas, editar catalogo y guardar sin cambiar contratos |
| 3 | Requisitos | Tests de requisitos/cache/matriz; consulta en browser con respuestas simuladas; lazy imports funcionales |
| 4 | Reservas | Crear, editar, eliminar, leer PNR/PDF y mostrar check-in; asociaciones con pasajeros intactas |
| 5 | Pasajeros y Documentos | Alta/edicion/busqueda, OCR simulado y salida SSR/FOID identica para fixtures existentes |
| 6 | Alertas | Fechas, deduplicacion y marcas conservadas entre cron y cliente; ningun correo real en QA |
| 7 | Administracion | Agencias, roles, usuarios, perfiles fiscales y uso conservan permisos y transacciones |
| 8 | Reducir coordinador y cerrar documentacion | `app.mjs` coordina las pantallas extraidas; no conserva implementaciones duplicadas |

En cada etapa se ejecutan `npm test` y `npm run build:frontend`, mas los tests del
modulo que no entren en `npm test`. Cualquier cambio de reglas exige
`npm run test:rules:emulator`. Al modificar Facturacion ejecutar tambien
`npm run test:billing:emulator` y `npm run test:billing:ui` con el frontend generado.
Validar el paquete con `tests/billing-package.smoke.mjs` siguiendo la preparacion de
CI; ejecutar `scripts/bundle-functions.mjs` solo en un entorno local sin credenciales
de Sentry si la prueba no debe publicar source maps.

Antes de mover logica sin cobertura, agregar pruebas de caracterizacion del
comportamiento actual. Para reglas nuevas o bugs, aplicar red-green-refactor.
Actualizar tests que inspeccionan texto o rutas fisicas sin eliminar sus aserciones
funcionales. La prueba de browser debe cubrir tambien volver a la vista, cerrar
sesion y entrar con otra agencia, para detectar estado y listeners residuales.

## Riesgos concretos y controles

- Imports relativos y cargas dinamicas: revisar todos los consumidores, incluidos
  tests y generadores. El build debe resolver el grafo completo dentro de la misma
  version, tambien en subcarpetas y con sesiones de versiones anteriores.
- Datos generados: `conocidos.mjs` y `lib/matriz.mjs` no se editan a mano. Si cambian
  de ubicacion, actualizar generadores, consumidores y tests juntos.
- Publicacion accidental: comprobar que `.netlify/site` contiene solo contenido
  publico. Tests, fuentes privadas de PDF, secretos y documentos permanecen fuera.
- PDF y funciones: comprobar fuentes, logo y dependencias en el paquete final;
  que el renderer funcione desde el archivo fuente no demuestra que el zip funcione.
- Aislamiento: conservar claims, validaciones backend, rutas Firestore y limpieza de
  listeners. La reorganizacion no requiere migrar datos ni cambiar reglas.
- Estilos y HTML: conservar selectores e IDs al principio. Separar CSS o plantillas
  solo dentro de la etapa de su pantalla, con comprobacion visual y de accesibilidad.

## Trabajo en Git y puesta en produccion

Esta propuesta queda en una rama local con worktree independiente. No se hace push a
main, merge, deploy manual ni cambios de configuracion remota. Los cambios pendientes
en otros worktrees no forman parte del plan.

La implementacion futura debe usar ramas de trabajo y commits por funcionalidad.
Antes de un eventual push o preview, comprobar automatizaciones y conexiones a datos
reales. El workflow actual despliega cuando recibe un push a main; por eso integrar
el refactor y publicarlo requiere una decision posterior del usuario.

Cada commit de extraccion debe poder revertirse sin migraciones de datos. El cierre
de la modularizacion exige tests y build aprobados, smoke tests de las pantallas
movidas, grafo reindexado y documentacion de ubicaciones actualizada. La cantidad de
lineas de `app.mjs` es una referencia, no un objetivo que justifique capas innecesarias.
