# TODO del facturador TravelDocs

Actualizado: 2026-11-02.
Estado: PR #4 aprobado e integrado; produccion configurada y ARCA consultada con
el store definitivo. Pendiente verificar el panel tras corregir el arranque PDF.
No se emitieron comprobantes reales.
Rama de correccion: `codex/facturador-pdf-startup`.
Base: `05dccb1b6059ecc2a0e58b805876f0e8453cfa94`.
Integrada en esta rama la correccion `9f9bf71` de main, sin modificar main.

## Alcance

Trabajar solo en este worktree, sin subagentes. El usuario aprobo integrar el PR #4
y activar produccion el 2 de noviembre. Conservar el checkout original. La emision
real requiere revision y confirmacion manual de cada factura desde el panel.

Las pruebas usan datos ficticios, Firestore emulado y ARCA homologacion. Los
certificados, claves, PDFs y datos fiscales personales quedan fuera del repo.
Una rama o un preview no aislan Firebase ni los correos por si solos.

## Reglas confirmadas

- 30 dias gratuitos desde la fecha de creacion, en hora de Argentina. Activa
  no significa facturable. Si la prueba termina el dia 1, puede facturarse ese
  mes; si termina otro dia, comienza el siguiente, sin prorrateo.
- Ficha fiscal opcional y guardable incompleta. Completarla habilita el siguiente
  inicio de mes, respetando la prueba; guardar nunca emite. Sin retroactivos.
- Reactivacion y cambios de precio desde el mes siguiente. El precio anterior
  se conserva para una factura pendiente del mes actual.
- Precio fijo por agencia, sin adicionales por uso. ARS o USD; los USD se pagan
  en USD a la caja de ahorro en USD del emisor.
- Factura C como monotributista; condicion IVA del receptor por separado.
- Mes del servicio igual al mes de emision. Desde, Hasta y vencimiento son un
  solo dia: la fecha de emision, como en los cuatro comprobantes revisados.
- Suspension o eliminacion bloquean nuevas emisiones y conservan historial.
- Primera etapa manual: vista previa, confirmacion, PDF y envio por el usuario.
  Automatizacion y correo quedan para despues de validar este circuito.

## 0. Aislamiento

- [x] Worktree separado y rama `codex/facturador`; checkout original preservado.
- [x] Workflow de deploy condicionado a main; PR #4 integrado y publicado con autorizacion.
- [x] Homologacion aislada de Firebase real. Produccion requiere proyecto, emisor,
  punto y confirmacion explicitos, sin emulador y con bundle de produccion.
- [x] Emulador demo-billing y navegador con servicios interceptados.
- [ ] Preparar Firebase y administradores de prueba para un preview navegable.
  El frontend conserva su configuracion existente; no usarlo contra produccion.

## 1. Explorar lo existente

- [x] Revisar CRUD de agencias, permisos, fechas y eliminacion.
- [x] Reutilizar adminFetch, confirmacion, tablas y estilos del admin existente.
- [x] Aplicar TDD, ponytail, seguridad, Hallmark de app existente y humanizer.
- [x] Revisar Node, empaquetado de Functions y workflow.
- [ ] Reindexar grafo: pendiente por rechazo de revision automatica al posible
  envio del repositorio privado a un destino no verificado. Revision local hecha;
  no se intento eludir el bloqueo.

## 2. SDK y homologacion

- [x] Fijar `facturas` en 0.25.2; Node 22. Renderer propio con React PDF 4.9.0.
- [x] Certificado, clave y autorizacion wsfe de homologacion verificados fuera del repo.
- [x] Consultar tipos, numeracion y cotizacion; punto 1 verificado por emision.
  El listado de puntos devuelve vacio en homologacion; no se creo punto real.
- [x] Usar store persistente para WSAA; resuelto `coe.alreadyAuthenticated` al
  renovar el ticket. No alternar stores vacios con el mismo certificado.
- [x] Facturas C ARS/USD 1 y 2 autorizadas y recuperadas sin duplicar.
- [x] Notas C totales 1 y 2 autorizadas contra esos comprobantes de prueba.
- [x] Concurrencia con claves repetidas: solo facturas 3 y 4.
- [x] Servicio implementado + Firestore local + ARCA + PDF: facturas 5 y 6,
  ARS/USD, doble confirmacion sin duplicados.
- [x] 2026-11-01: homologacion con datos fiscales del emisor y de Valdes/Transitar
  tomados de los PDFs previos. C ARS 60.000 y USD 100 autorizadas, numeros 7 y 8
  del punto de prueba 1. Doble confirmacion sin duplicados; PDFs revisados.
  Fechas de elegibilidad sembradas solo en emulador; no se consultaron ni cambiaron
  las fichas o estados de las agencias de produccion.

## 3. Elegibilidad y fechas

- [x] Tests rojos antes de implementar reglas de fechas, precios y validaciones.
- [x] 30 dias, dia 1/dia 20, meses cortos, bisiesto, cambio de ano y zona ART.
- [x] Cinco agencias activas gratuitas no habilitadas para facturar.
- [x] Bloqueos por ficha incompleta, fecha desconocida, suspension y eliminacion.
- [x] Vigencia mensual de ficha, reactivacion y precio; sin recuperar meses.
- [x] Separar mes del servicio de fecha de emision y mostrar estado en admin.

## 4. Ficha fiscal privada

- [x] Coleccion privada `billingProfiles`, separada de agencias.
- [x] CUIT con verificador, razon social, domicilio, condicion, moneda y centavos.
- [x] Alta y edicion sin ficha o con datos parciales; guardar no emite.
- [x] Rutas protegidas por administrador de plataforma.
- [x] Owner, admin y agent sin lectura/escritura directa a colecciones fiscales.
- [x] Reactivacion al mes siguiente y ficha nueva al recrear un slug eliminado.

## 5. Persistencia y recuperacion

- [x] Adaptador ArcaStore Firestore: add atomico, locks, renovacion, lease vencido,
  liberacion por propietario y cancelacion. ARCA fuera de transacciones.
- [x] Secuencia fiscal compartida coordinada por el SDK; tickets persistidos.
- [x] Obligacion mensual unica e intentos rechazados archivados por separado.
- [x] Solicitud y datos aprobados guardados antes de enviar; confirmacion por intento.
- [x] Recuperar antes de reenviar; reintento explicito solo con not_found.
- [x] Bloquear blocked/failed/superseded/aborted/incomplete, cambios de datos,
  emisor/punto cambiado y suspension concurrente.
- [x] Corte despues del CAE o fallo de persistencia recuperan sin segunda emision.
- [x] Consultar un borrador nunca lo emite; confirmacion vieja no autoriza otro intento.
- [x] Historial conservado al eliminar agencia; snapshots para reproducir PDF.
- [x] Mensajes amigables para conexion, timeout, acceso, configuracion, validacion,
  rechazo y resultado incierto. Aviso visible en el panel y error seguro persistido
  en el intento. Recuperar limpia el aviso sin volver a emitir. Detalle ARCA plegado.

Limites: un intento incierto de otro dia o con datos cambiados requiere revision
manual. Tambien requiere revision un corte antes de que el SDK guarde la reserva,
si su recuperacion informa que no existe. No borrar reservas para desbloquear.

## 6. Emision manual y PDF

- [x] Factura C de servicios, importe exacto, fechas de un dia y mes actual.
- [x] USD pagado en USD con cotizacion ARCA guardada en el snapshot.
- [x] Consultar cotizacion por fecha anterior a la emision: retroceder solo ante
  602 sin resultados, hasta diez dias, sin calcular feriados locales. Errores de
  conexion y autorizacion interrumpen la consulta. Validacion fiscal conservada.
  SDK 0.25.2 adaptado en postinstall para aceptar FchCotiz; version y texto
  comprobados para fallar si una actualizacion exige revisar la adaptacion.
- [x] Boton y dialogo identificados como Vista previa; emitir requiere confirmacion.
  Borradores reales ARS/USD probados con ARCA el 2 de noviembre, sin emitir.
- [x] Vista previa, confirmacion y revalidacion transaccional antes de emitir.
- [x] Historial y PDF autorizado con CAE/QR; descarga sin volver a emitir.
- [x] Condicion de venta habitual por agencia, Transferencia bancaria por defecto.
  Una opcion, editable por comprobante antes de confirmar; guardada en snapshot.
  El cambio puntual no modifica la ficha ni los PDF anteriores.
- [x] Servicios fijado como concepto y visible en confirmacion. USD con cotizacion
  consultada a ARCA; no confundir la respuesta de homologacion con produccion.
- [x] Plantilla PDF adaptada al diseño aportado por el usuario (React y HTML):
  franja de colores, marca con avion, cabecera azul, emisor, tarjetas, tabla y total.
  Fuentes IBM Plex locales con licencia; QR generado desde cada autorizacion.
  Valdes y Transitar regeneradas en una hoja A4 sin nueva emision.
  Campos fiscales verificados y renderer/fuentes probados en el paquete Netlify.
- [x] Logo editorial provisto el 2 de noviembre: SVG original conservado y PNG
  transparente de alta resolucion incluido en cabecera y pie. Fondo claro en
  la cabecera, segun la captura; datos y autorizaciones fiscales sin cambios.
- [x] Verificacion visual de PDFs ficticios ARS/USD y generacion con ARCA real test.
- [x] Renderer como dependencia externa: verificada carga del artefacto Netlify.
- [x] Procedimiento de correccion documentado; notas de credito probadas con SDK.
  No se agrego interfaz de notas de credito en esta etapa.

## 7. Verificacion y entrega

- [x] Suite general: 454 pruebas aprobadas en Node 22, incluidas las regresiones del PR.
- [x] Emulador de facturacion: 21 pruebas aprobadas (store, servicio e importacion inicial).
- [x] Reglas Firestore: 45 pruebas aprobadas; no se modificaron las reglas.
- [x] Navegador: regresiones del panel y MFA aprobadas con servicios simulados.
- [x] Navegador facturador: ficha parcial, prueba gratuita, importe, confirmacion y PDF.
- [x] Build de frontend, bundle Functions y carga del renderer PDF verificados.
- [x] Revision local de seguridad y ponytail del diff.
- [x] Hallmark aplicado al area tocada. El chequeo global sigue con fallos previos
  de la app; no se restileo el producto para resolverlos. En esta vuelta el render
  de Hallmark no encontro puppeteer-core; la interfaz se verifico con el smoke
  de Chrome en ambos ambientes simulados y sus capturas.
- [x] Guia de operacion y limites: `docs/FACTURADOR-HOMOLOGACION.md`.
- [x] Guardar commit local solo en `codex/facturador`.
- [x] Usuario aprobo los PDFs, incluida marca TravelDocs y ejemplo con sus datos fiscales.
- [x] Demo local interactiva abierta en Chrome aislado: cinco agencias gratuitas y
  dos listas, ARS/USD; sin conexiones a servicios reales. CRUD con fixture en memoria;
  emision simulada rotulada y descarga PDF comprobadas antes de entregar la ventana.
- [x] Ajuste solicitado por el usuario: datos fiscales en desplegable nativo cerrado
  por defecto, pestaña Facturacion junto a Uso y gasto, emision e historial en ella.
  Prueba de teclado, guardado parcial, confirmacion y descarga aprobadas.
- [ ] Revision del panel actualizado por el usuario en esa demo. No sustituye una prueba completa
  con Firebase aislado y ARCA homologacion desde el navegador antes de publicar.

## Revision del PR #4

- [x] Reproducir y corregir completar ficha parcial sin cambiar el precio: se
  compara la tarifa programada del siguiente mes, no solo el ultimo formulario.
- [x] Corregir tarifa futura desactualizada al recompletar una ficha; conservar
  el precio pendiente del mes actual.
- [x] El panel exige habilitacion y tarifa vigente para mostrar listo para emitir.
- [x] Preview revisa el intento mensual dentro del lock antes de pedir cotizacion.
  Autorizadas o en consulta devuelven su snapshot sin nueva llamada a ARCA.
- [x] Aviso al consultar una factura ya autorizada; los intentos pendientes muestran
  su estado. No se abre otra confirmacion ni se emite de nuevo.
- [x] Auditoria de cambio fiscal y de emision, consulta, reintento y descarga: actor,
  id y estado, sin datos fiscales, claves ni digest. Fallo auxiliar no interrumpe
  la operacion fiscal. Ambas Functions usan el wrapper existente de Sentry.
- [x] PDF productivo empaquetado con NFT para conservar el bundle y debug id de
  Sentry. Assets dinamicos de pdfkit y dependencias de inyeccion de Sentry incluidos.
  Paquete probado con Netlify CLI 27.12.1, renderer y PDF A4; bundle byte por byte
  identico al generado antes de empaquetar. Sin envio de eventos a Sentry real.
- [x] Quitar linea vacia sobrante en billing-form.mjs.
- Se conserva billingProfiles al eliminar una agencia: las comprobaciones de
  existencia bloquean nuevas emisiones y recrear el slug reinicia la ficha.
  No se altero esa politica de retencion durante la correccion.
- direct-messages.test.mjs es previo al facturador y sigue fuera de este cambio.
  La licencia original de IBM Plex conserva sus finales CRLF.

## 8. Activacion de produccion y pendientes

- [x] Produccion: certificado autorizado y punto 00002 creados por el usuario.
- [x] Configuracion y publicacion autorizadas despues de aprobar PR #4.
- [x] Usuario confirma el 2 de noviembre que Valdes y Transitar siguen pendientes
  de facturar noviembre. Preparados clave local separada y CSR de produccion,
  fuera del repo.
- [x] Certificado de produccion recibido el 2 de noviembre: CUIT y clave publica
  coinciden con la solicitud y la clave local. Vence el 1 de noviembre de 2028.
  Copia privada guardada fuera del repo; wsfe autorizado y acceso verificado.
- [x] Usuario asocio el certificado a Facturacion Electronica. Acceso a wsfe de
  produccion verificado con consulta de solo lectura el 2 de noviembre. La consulta
  inicial vino vacia. Tras el alta, devolvio el punto 2 habilitado. Proximo numero C: 1;
  cotizacion consultada: 1534, fecha 20261030. Consultas sin reserva ni emision.
- [x] Modo produccion implementado con guardas, SDK configurado por ambiente,
  obligaciones y claves separadas. Snapshots viejos sin ambiente siguen siendo test.
  Panel y confirmacion distinguen factura real; PDF real sin leyenda de homologacion.
- [x] Credenciales reales previstas en billingSecrets/production, solo Admin SDK,
  para evitar el limite de 4 KB de variables de Lambda. Aislamiento testeado.
- [x] Corte inicial confirmado: Valdes y Transitar desde 2026-11, sin retroactivos.
  Importador con simulacion por defecto y transaccion sin sobrescrituras; probado
  solo con agencias ficticias del emulador. Mantener CUIT en Ingresos Brutos.
- [x] Ids y fechas contrastados en el panel autenticado, sin guardar credenciales.
  Usuario confirma los importes de noviembre. Manifiesto y emisor preparados solo
  en archivos privados temporales, con datos fiscales de los snapshots previos.
- [x] Manifiesto validado contra el backend y corte inicial aplicado sin sobrescrituras.
- [x] Respaldo privado, carga de credenciales y traspaso de un ticket WSAA a Firestore.
- [x] Siete variables verificadas mediante API, solo en production. El usuario
  autorizo scopes estandar: limitar a Functions devolvia 403 en su plan.
  Certificado y clave permanecen en Firestore privado.
- [x] Reproducir fallo de entrada PDF: wrapper CommonJS heredaba type=module.
  Excluir solo package.json de raiz del artefacto NFT, sin reescribir bundle ni debug id.
  Smoke de empaquetado agregado al workflow: carga entrada real y exige 401 sin token.
- [ ] Verificar PDF publicado y vistas previas conectadas desde el panel autenticado.
  Guia: docs/FACTURADOR-PRODUCCION.md.
- [ ] Definir backups, renovacion de certificados y operacion de correcciones reales.
- [ ] Primera factura real revisada manualmente; no emitir pruebas reales.
- [ ] Cron: acordar dia habil, horario, feriados y tratamiento de pendientes.
- [ ] Automatizar emision luego de validar el circuito manual; envio por email despues.

## Evidencia y referencias

Credenciales y evidencia fiscal de homologacion en el directorio privado local
`~/.traveldocs-arca-homologacion/`, sin contenidos sensibles en este documento.
El certificado de prueba no sirve para produccion.

- https://github.com/LaPyme/facturas
- https://www.afip.gob.ar/fe/ayuda/webservice.asp
- https://firebase.google.com/docs/firestore/security/rules-fields
- https://docs.netlify.com/build/functions/overview/
