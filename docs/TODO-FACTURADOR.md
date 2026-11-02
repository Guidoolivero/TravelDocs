# TODO del facturador TravelDocs

Actualizado: 2026-11-02.
Estado: circuito manual implementado y probado en homologacion; pendiente revision
del panel y preparacion de un entorno navegable con Firebase aislado.
Rama: `codex/facturador`.
Base: `05dccb1b6059ecc2a0e58b805876f0e8453cfa94`.

## Alcance

Trabajar solo en este worktree, sin subagentes. No hacer push o merge a main,
ni deploy de produccion. Esta instruccion del usuario reemplaza la pauta general
del repositorio de publicar cada cambio en main.

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
- [x] Workflow de deploy condicionado a main; ningun push ni deploy ejecutado.
- [x] Bloqueo de facturacion salvo ARCA test y Firebase de pruebas configurado.
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

- [x] Suite general: 440 pruebas aprobadas en Node 22.
- [x] Emulador de facturacion: 18 pruebas aprobadas (store y servicio).
- [x] Reglas Firestore: 45 pruebas aprobadas; no se modificaron las reglas.
- [x] Navegador: regresiones del panel y MFA aprobadas con servicios simulados.
- [x] Navegador facturador: ficha parcial, prueba gratuita, importe, confirmacion y PDF.
- [x] Build de frontend, bundle Functions y carga del renderer PDF verificados.
- [x] Revision local de seguridad y ponytail del diff.
- [x] Hallmark aplicado al area tocada. El chequeo global sigue con fallos previos
  de la app; no se restileo el producto para resolverlos.
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

## 8. Fuera de esta etapa

- [ ] Produccion: certificado, punto de venta y configuracion con autorizacion aparte.
- [x] Usuario confirma el 2 de noviembre que Valdes y Transitar siguen pendientes
  de facturar noviembre. Preparados clave local separada y CSR de produccion,
  fuera del repo.
- [x] Certificado de produccion recibido el 2 de noviembre: CUIT y clave publica
  coinciden con la solicitud y la clave local. Vence el 1 de noviembre de 2028.
  Copia privada guardada fuera del repo; falta autorizar wsfe y verificar acceso.
- [x] Usuario asocio el certificado a Facturacion Electronica. Acceso a wsfe de
  produccion verificado con consulta de solo lectura el 2 de noviembre. La consulta
  de puntos de venta devolvio una lista vacia; falta verificar/crear el punto.
- [ ] Confirmar punto de venta y completar habilitacion tecnica y publicacion. La rama sigue bloqueando produccion; no cambiar solo
  una variable para intentar emitir. Guia: docs/FACTURADOR-PRODUCCION.md.
- [ ] Definir corte inicial y meses ya facturados a mano para evitar duplicarlos.
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
