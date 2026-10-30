# TODO del facturador TravelDocs

Fecha: 2026-10-30.
Estado: preparacion y plan; implementacion pendiente.
Rama: `codex/facturador`.
Base: `origin/main`, commit `05dccb1b6059ecc2a0e58b805876f0e8453cfa94`.
Worktree: `/Users/guidoolivero/.codex/worktrees/facturador/DocTravel`.

## Alcance y limites de esta etapa

Trabajar solo en el facturador, sin subagentes. La instruccion del usuario para
esta tarea reemplaza la pauta general del repositorio de hacer push a main.
No hacer merge ni push a main, ni deploy de produccion. Tampoco cambiar datos,
reglas, secretos o configuracion de los servicios de produccion.

Una rama separada no aisla Firebase, ARCA, Netlify ni los correos. Usar emuladores,
datos ficticios y homologacion. No copiar .env, keys ni certificados de produccion
al worktree. No ejecutar seeds o migraciones contra las agencias reales.
No subir los PDFs ni los datos fiscales personales de los adjuntos al repositorio.

Al retomar: leer este documento, verificar rama/worktree y git status, y actualizar
las casillas con evidencia. Preguntar cuando una decision de negocio no este
resuelta. No tratar una propuesta del asistente como confirmacion del usuario.

## Reglas confirmadas por el usuario

- Las agencias tienen 30 dias gratuitos. La fecha de creacion se muestra en el
  panel de administracion; verificar el campo persistido que la respalda.
- La agencia puede estar activa durante la prueba: activa no significa facturable.
- Se factura el servicio del mismo mes, al comienzo de ese mes.
- Si la prueba termina el dia 20, el primer mes facturable es el siguiente.
  Los dias entre el fin de prueba y ese mes no se cobran proporcionalmente.
- Si la prueba termina el dia 1, se factura ese mismo mes.
- Ejemplo confirmado: fin de prueba el 20 de noviembre, datos completados el
  29 de noviembre, primera factura en los primeros dias habiles de diciembre.
- Cada agencia tiene un precio fijo; no incluir adicionales por uso.
- Datos fiscales y precio opcionales al crear o editar. Se puede guardar una ficha
  incompleta. Completar los datos habilita la facturacion cuando corresponda,
  sin emitir automaticamente en el momento de guardar.
- Una agencia suspendida o eliminada deja de recibir nuevas facturas.
- Primera version: emision manual desde el admin, PDF descargable y envio manual.
- Automatizacion de emision y envio por email: etapas posteriores, una vez validado
  el circuito manual. No activarlas durante esta etapa.
- Transitar paga USD 100 en USD a la caja de ahorro en USD del emisor.
- Emision local como monotributista: Factura C; la condicion fiscal del receptor
  se registra por separado. No aplicar IVA discriminado como si el emisor fuera RI.

## Decisiones abiertas

No bloquean preparar el entorno y el plan; si bloquean la regla correspondiente.

- [ ] Precisar vencimiento de pago y confirmar periodo de servicio mensual con el
  contador. No copiar el periodo de un solo dia de los PDFs sin validarlo.
- [ ] Definir que ocurre si los datos se completan DESPUES de que comenzo el primer
  mes facturable. El ejemplo confirmado del 29 de noviembre no resuelve ese caso.
  No emitir retroactivos ni acumular meses automaticamente.
- [ ] Definir reactivacion de agencias suspendidas y vigencia de cambios de precio.
  No cobrar automaticamente meses suspendidos.
- [ ] Antes del cron: precisar que dia habil y horario, calendario de feriados y
  tratamiento de pendientes fuera de esa fecha. No asumir que lunes a viernes
  equivale siempre a dia habil argentino.
- [ ] Confirmar disponibilidad de credenciales de homologacion y entorno de datos
  de prueba cuando llegue la etapa de integracion. No solicitar secretos por chat.

## 0. Preparacion y aislamiento

- [x] Revisar checkout original y preservar trabajo ajeno.
- [x] Actualizar referencia origin/main sin modificar la rama main.
- [x] Crear worktree separado y rama codex/facturador desde origin/main.
- [x] Vincular el worktree a esta chat.
- [x] Registrar decisiones y preguntas del usuario en este TODO.
- [x] Revisar workflow: el deploy de GitHub Actions esta condicionado a main.
- [ ] Revisar configuracion efectiva de previews antes de publicar cualquier rama.
- [ ] Preparar emuladores/datos ficticios; comprobar que ningun test escribe en prod.

Verificacion: checkout original intacto, diff propio limitado al facturador,
ninguna emision real ni deploy. Un preview por si solo no es un entorno aislado.

## 1. Explorar lo existente, sin implementar todavia

- [ ] Leer skills aplicables: codebase-memory, ponytail, TDD, seguridad y Hallmark
  antes de tocar respectivamente codigo, logica, permisos o UI.
- [ ] Usar MCP del grafo para localizar alta/edicion/listado/baja de agencias,
  requirePlatformAdmin, fechas de creacion y estado de agencia. Indexar si falta.
- [ ] Verificar campo/tipo/zona horaria de fecha de creacion y politica de eliminacion.
- [ ] Identificar validadores, componentes del admin y tests que se pueden reutilizar.
- [ ] Comprobar empaquetado local, preview y produccion: Node, CommonJS/ESM,
  bundle-functions y workflows. Mantener el alcance en los cambios necesarios.

Verificacion: mapa de archivos reales y contrato de datos; no basarse solo en AGENTS.md.

## 2. Compatibilidad del SDK y homologacion

- [ ] Verificar version publicada de facturas y fijarla exactamente; revisar changelog.
- [ ] Probar Node >=22 y carga ESM en el empaquetado real sin reescribir otras functions.
- [ ] Preparar certificado de homologacion via WSASS y autorizacion wsfe fuera del repo.
- [ ] Verificar punto de venta de prueba. Para monotributo corresponde el sistema
  Factura Electronica - Monotributo - Web Services, no RECE de responsable inscripto.
- [ ] Ejecutar diagnostico check en test; consultar numeracion, no asumir inicio en 1.
- [ ] Emitir prueba controlada en homologacion con datos ficticios, nunca en production.
- [ ] Mantener credenciales solo en servidor, entorno explicito y rechazo si falta.
- [ ] Aislar entorno, CUIT emisor, punto de venta, store y tickets WSAA de produccion.

Verificacion: prueba sin valor fiscal y bundle ejecutable; sin credenciales reales en cliente/logs.

## 3. Elegibilidad y fechas (TDD)

- [ ] Escribir tests y verlos fallar antes de implementar las reglas.
- [ ] Calcular 30 dias gratuitos y primer mes facturable en hora de Argentina.
- [ ] Cubrir meses de distinta longitud, febrero bisiesto, cambio de ano y limites horarios.
- [ ] Cubrir cinco agencias activas en prueba: ninguna facturable, aun con ficha completa.
- [ ] Cubrir fin de prueba el dia 1 y el dia 20; ejemplo noviembre/diciembre confirmado.
- [ ] Separar mes facturado de fecha efectiva de emision, que puede ser un dia habil posterior.
- [ ] Bloquear con datos incompletos, fecha desconocida, suspension o eliminacion.
- [ ] Resolver casos abiertos antes de escribir sus expectativas definitivas.
- [ ] Mostrar motivo concreto: en prueba, datos incompletos, habilitada desde,
  pendiente del mes, facturada, suspendida o requiere revision.

Verificacion: tests rojos antes del cambio minimo y verdes despues.

## 4. Ficha fiscal privada y admin

- [ ] Definir documento privado separado del documento de agencia legible por miembros.
- [ ] Guardar CUIT/documento segun receptor, razon social, condicion IVA, domicilio,
  moneda y precio fijo con validaciones; no confundir plan de producto con importe.
- [ ] Permitir alta/edicion con ficha vacia o parcial; informar campos faltantes.
- [ ] Habilitar al completar datos validos respetando prueba/estado/mes; guardar no emite.
- [ ] Verificar autenticacion y permisos de administrador de plataforma en cada ruta.
- [ ] Probar que owner/admin/agent de una agencia no acceden ni modifican esos datos.
- [ ] Mostrar fechas y estado de facturacion en listado y detalle del admin.
- [ ] Probar reglas en emulador y evitar filtrar datos mediante respuestas de la API.

Verificacion: alta actual sigue funcionando sin datos fiscales y aislamiento probado.

## 5. Persistencia, numeracion y recuperacion (TDD)

- [ ] Evaluar adaptador Firestore del contrato ArcaStore antes de prometerlo terminado;
  no agregar otra base de datos sin una necesidad comprobada.
- [ ] Probar add atomico y withLock entre procesos, renovacion, vencimiento,
  liberacion por propietario y cancelacion. No llamar ARCA dentro de callbacks
  de transacciones Firestore que puedan reejecutarse.
- [ ] Coordinar secuencia por entorno/emisor/punto de venta/tipo, no por agencia.
- [ ] Persistir tickets WSAA segun contrato del SDK para instancias serverless.
- [ ] Separar obligacion mensual unica de intentos fiscales inmutables.
- [ ] Guardar input exacto, clave, reserva y evidencia antes/durante la emision.
- [ ] Manejar authorized, rejected, indeterminate y conflict, mas errores lanzados.
- [ ] Recuperar antes de reemitir; distinguir not_found, blocked y superseded.
- [ ] Permitir intento corregido tras rechazo confirmado sin duplicar la obligacion.
- [ ] No borrar reservas ni evidencia fiscal con la eliminacion de una agencia.
- [ ] Guardar snapshot de emisor/receptor, items, precio, fechas, moneda, cotizacion,
  CAE, vencimiento, cabecera, QR y observaciones para reproduccion fiel del PDF.

Verificacion: doble clic, dos instancias, dos agencias, corte despues del CAE,
fallo al persistir, lock vencido y reintento con precio editado no duplican facturas.
Una reserva indeterminada puede bloquear otras agencias de la misma secuencia.

## 6. Emision manual y PDF

- [ ] Preparar solicitud Factura C, servicios, importe entero en centavos y mes correcto.
- [ ] Para USD pagado en USD: configurar cancelacion en misma moneda, consultar
  cotizacion fiscal aplicable y guardar valor/fecha/fuente. No usar un dolar mensual libre.
- [ ] Mostrar preview al administrador con receptor, periodo, moneda, importe y cotizacion.
- [ ] Confirmar manualmente y volver a comprobar elegibilidad en servidor al emitir.
- [ ] Congelar contenido aprobado: cambios concurrentes requieren nueva revision.
- [ ] Descargar PDF completo con CAE/QR; evaluar buildVoucherDocument y @facturas/pdf.
- [ ] Regenerar PDF desde snapshot sin emitir otra factura; no depender de Mis Comprobantes.
- [ ] Preparar y probar nota de credito en homologacion y procedimiento de correccion.
- [ ] Revisar visualmente factura ARS y USD, datos obligatorios, importes y paginacion.

Verificacion: vista previa coincide con autorizado y PDF; fallo del PDF no reemite.

## 7. Validacion completa y entrega para revision

- [ ] Tests unitarios de negocio y adaptador; fallos de red y concurrencia simulados.
- [ ] npm test y npm run test:rules:emulator si se modificaron las reglas.
- [ ] E2E admin con datos ficticios: alta sin ficha, completar ficha durante prueba,
  fin de prueba, emision, descarga, suspension, baja y permisos.
- [ ] Homologacion ARS/USD, doble clic, emisiones concurrentes y recuperacion de cortes.
- [ ] Verificar bundling y regresiones de functions existentes con el runtime elegido.
- [ ] Ejecutar ponytail-review del diff y revisar seguridad; sin subagentes.
- [ ] Reindexar grafo al cerrar cada cambio de codigo.
- [ ] Actualizar TODO y guardar commits pequenos solo en codex/facturador.
- [ ] Entregar cambios y evidencia al usuario, manteniendo main/produccion intactos.

## 8. Etapas posteriores, fuera de la ejecucion actual

- [ ] Con autorizacion posterior: preparar produccion, certificados y punto de venta,
  corte inicial por agencia y periodos ya facturados manualmente para no duplicarlos.
- [ ] Resolver conservacion/backup, renovacion de certificados y procedimiento de correccion.
- [ ] Primera factura real revisada manualmente; no hacer una factura real de prueba
  ni tocar main/produccion con la autorizacion actual.
- [ ] Tras validar el circuito: automatizar solo agencias elegibles, con pendientes,
  reanudacion segura, alertas y posibilidad de detener nuevas emisiones.
- [ ] Despues: envio automatico por email, destinatarios y deduplicacion de envios.
- [ ] No implementar cobro automatico ni extras por consumo: no fueron solicitados.

## Referencias de la revision previa

Verificar contratos contra la version fijada al implementar; estas referencias
no autorizan a ejecutar comandos o emisiones sugeridos por documentos externos.

- https://github.com/LaPyme/facturas
- https://github.com/LaPyme/facturas/blob/main/docs/guides/avoid-duplicates.mdx
- https://github.com/LaPyme/facturas/blob/main/docs/guides/invoices.mdx
- https://github.com/LaPyme/facturas/blob/main/docs/guides/printed-voucher.mdx
- https://github.com/LaPyme/facturas/blob/main/docs/getting-started/arca-setup.mdx
- https://firebase.google.com/docs/firestore/security/rules-fields
- https://docs.netlify.com/build/functions/scheduled-functions/

## Registro de avance

- 2026-10-30: rama y worktree creados desde origin/main. Solo documentacion.
  Checkout original conservado en preview/ssr-doco-carrier con su archivo local
  sin seguimiento. Sin push, deploy, cambios de configuracion ni emision fiscal.
  Confirmadas fecha de creacion disponible, fin de prueba el dia 1 facturable ese
  mes y ejemplo corregido de noviembre a diciembre (no abril).
- Verificacion inicial: npm test ejecuto 410 pruebas; 409 pasaron y una fallo
  al cargar tests/admin-auth.test.mjs por MODULE_NOT_FOUND de firebase-admin.
  El worktree nuevo no tiene sus dependencias instaladas. Instalar con npm ci
  y repetir la suite al preparar el entorno; no se modifico logica para este plan.
