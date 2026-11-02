# Facturador: pruebas y operacion manual

Esta version funciona solo con ARCA homologacion y una base Firebase aislada.
No permite emitir en produccion. La rama es `codex/facturador`; no se publico
ni se modificaron las agencias reales.

## Reglas

- La prueba gratuita dura 30 dias desde el alta, usando la fecha de Argentina.
  Si termina el dia 1, ese mes puede facturarse. En otro dia, comienza el mes
  siguiente. La ficha completa tambien debe estar vigente.
- Completar la ficha o reactivar una agencia habilita el siguiente inicio de mes.
  Los cambios de precio se aplican desde el mes siguiente. Una factura pendiente
  del mes actual mantiene el precio anterior.
- La ficha es opcional y puede guardarse incompleta. CUIT, razon social,
  domicilio, condicion IVA, moneda e importe validos son necesarios para emitir.
- Se factura el mes actual, sin recuperar meses anteriores. Desde, Hasta y
  vencimiento llevan el dia de emision, por decision del usuario.
- Todas son facturas C de un monotributista. En USD se indica pago en USD y se
  consulta la cotizacion en ARCA. El precio del plan se guarda en centavos.
  El concepto es siempre Servicios. La cotizacion usada se ve en la confirmacion
  y el PDF; las respuestas del entorno test no se toman como cotizaciones de
  produccion. No se carga una cotizacion manual en la ficha.
- Suspender o eliminar una agencia impide nuevas emisiones. Sus comprobantes
  autorizados y los intentos fiscales se conservan fuera del documento de agencia.

## Uso del panel

1. Crear o editar una agencia y completar los campos opcionales de facturacion.
   El listado muestra prueba gratuita, ficha incompleta o mes de habilitacion.
2. La condicion de venta habitual se guarda en la ficha de agencia y parte de
   Transferencia bancaria. En la pestana Facturacion se puede elegir otra para
   ese comprobante antes de pulsar Facturar; ese cambio no modifica la ficha.
   Revisar receptor, CUIT, importe, moneda,
   mes, fechas, condicion de venta y cotizacion. Confirmar emite un comprobante
   de prueba. La condicion queda guardada con la factura; las siguientes ediciones
   de la ficha no cambian un PDF anterior.
3. Consultar el historial y descargar el PDF de las facturas autorizadas.
   Descargar o regenerar un PDF no vuelve a emitir. El envio es manual.
4. Ante un corte de conexion, usar Consultar ARCA. Solo un resultado not_found
   permite un reintento explicito con la misma clave y contenido.
5. Ante rechazo confirmado, corregir la ficha y volver a revisar. Se conserva
   el intento rechazado y se asigna una clave nueva al intento corregido.

Los errores se muestran en un aviso visible del panel, con el siguiente paso.
Si falla una emision o consulta, el intento conserva un mensaje seguro para
volver a verlo en el historial. La informacion tecnica de rechazos se despliega
con Ver detalle de ARCA. Ante una respuesta incierta nunca se afirma que no
se emitio: primero se consulta ARCA.

No borrar registros ni reservas para desbloquear una emision. Un conflicto,
una consulta fallida, un comprobante reemplazado o una secuencia bloqueada
requieren revision; no habilitan reenvio. Si un intento incierto pasa de dia o
cambian sus datos, el sistema bloquea el reenvio y requiere revision manual.
Si el proceso se corta antes de guardar la reserva del SDK y la recuperacion
informa que no existe, tambien requiere revision manual; no se cambia la clave
para intentar destrabarlo.
La recuperacion de una factura ya emitida sigue disponible aunque se suspenda
la agencia.

Para corregir un comprobante autorizado corresponde una nota de credito,
no borrar ni editar el original. Se probaron notas C totales en homologacion
mediante `issueCreditNote` del SDK. No hay boton para emitir notas de credito
en esta version: el administrador debe revisar el comprobante original y su
asociacion antes de ejecutar ese procedimiento. Produccion queda fuera de esta
etapa.

## Configuracion del servidor de prueba

Usar Node 22. Las variables solo van en el servidor de prueba:

| Variable | Contenido |
| --- | --- |
| BILLING_ENABLED | `true` |
| ARCA_ENVIRONMENT | `test` |
| BILLING_FIREBASE_PROJECT_ID | ID del proyecto aislado |
| FIREBASE_SERVICE_ACCOUNT | Cuenta de servicio del proyecto aislado |
| FIRESTORE_EMULATOR_HOST | Obligatoria si el proyecto comienza con `demo-` |
| ARCA_TAX_ID | CUIT del emisor |
| ARCA_SALES_POINT | Punto de venta de homologacion verificado |
| ARCA_CERTIFICATE_PEM | Certificado de homologacion completo |
| ARCA_PRIVATE_KEY_PEM | Clave privada correspondiente |
| BILLING_ISSUER_JSON | Objeto con `legalName`, `address`, `grossIncome`, `activitiesStartDate` |

Los datos fiscales del emisor deben ser los reales al configurar el entorno;
los ejemplos de los tests son ficticios. Las credenciales locales estan fuera
del repositorio, en `~/.traveldocs-arca-homologacion/`. Nunca copiarlas a public,
commits, capturas ni logs. El certificado de homologacion no sirve para produccion.

Los tickets WSAA y las reservas del SDK requieren persistencia. No alternar
stores vacios con el mismo certificado: ARCA puede responder
`coe.alreadyAuthenticated` hasta que venza el ticket anterior. Las Functions
usan Firestore; las pruebas directas usaron un store local persistente. La prueba
integrada reutilizo ese ticket y guardo las reservas en el emulador, con respaldo
local. No se necesita recrear el certificado por ese error.

El frontend mantiene la configuracion Firebase existente. No abrir un preview
contra servicios reales como si estuviera aislado: para revisar la interfaz,
`npm run test:billing:ui` intercepta Firebase, Functions y servicios externos.
Un deploy de prueba necesita su propio Firebase y usuarios administradores de
prueba antes de habilitar el facturador. No se preparo ni publico ese deploy.

## Verificacion del 31 de octubre de 2026

- Facturas C ARS y USD autorizadas por ARCA homologacion; comprobantes 1 y 2
  del punto de prueba 1. Recuperacion y replay conservaron la numeracion.
- Notas de credito C de prueba 1 y 2 autorizadas contra esos comprobantes.
- Dos clientes y dos claves en paralelo, cada una repetida: solo dos facturas,
  numeros 3 y 4. Una salida temprana del proceso se resolvio con las mismas claves.
- Circuito implementado con Firestore local, SDK, ARCA y PDF: numeros 5 y 6,
  en ARS y USD. Doble confirmacion produjo una sola factura por mes/agencia.
- PDFs con datos ficticios revisados; CAE, QR, moneda, importe y fechas presentes.
- Pruebas locales de permisos, fechas, precios, cancelacion, locks, recuperacion,
  rechazo corregido y suspension concurrente. El test de navegador cubre ficha
  parcial, importes, cinco agencias gratuitas, confirmacion y descarga sin reemision.

El 1 de noviembre de 2026 se repitio la prueba con los datos fiscales del emisor
y de Valdes/Transitar tomados de sus comprobantes anteriores: ARS 60.000 y USD 100.
ARCA test autorizo los numeros 7 y 8; doble confirmacion con el mismo numero
y PDFs revisados. Se usaron registros aislados con elegibilidad de prueba en
el emulador. Esto no valida las fechas o los saldos de las agencias reales.
Los PDFs y snapshots con datos fiscales se conservan localmente y no se versionan.

Comandos sin acceso a produccion:

```sh
npm test
npm run test:billing:emulator
npm run test:rules:emulator
npm run test:billing:ui
npm run build:frontend
```

La plantilla PDF reproduce el diseño aportado por el usuario en los archivos
TravelDocsInvoice.tsx y la carpeta implementacion-html. Usa React PDF 4.9.0,
con fuentes IBM Plex locales y su licencia en netlify/functions/lib/invoice-fonts.
El logo editorial entregado por el usuario se conserva como SVG y PNG en
netlify/functions/lib/invoice-assets, incluido en el paquete de la Function.
No carga Google Fonts ni imagenes remotas. Se conserva buildVoucherDocument
para verificar el contenido fiscal y se genera el QR desde el comprobante
autorizado, sin usar el PNG de demostracion de la maqueta.

El renderer se empaqueta como dependencia externa y las fuentes se incluyen
explicitamente en la Function. En produccion, NFT traza las dependencias sin
reescribir el bundle ya instrumentado por Sentry. El paquete incluye tambien los
archivos de fuentes dinamicas de pdfkit y las dependencias de inyeccion de Sentry;
su ausencia se detecto y corrigio en una prueba del artefacto con Netlify CLI 27.12.1.
Se comprobo que el archivo compilado conserva exactamente sus bytes y debug id.
No se enviaron eventos a Sentry real durante esa prueba. Se probo la generacion desde el artefacto Netlify
con Node 22, incluidos fuentes y QR. La factura mensual ARS y USD ocupa una
hoja A4; el contenido fiscal se conserva y la fecha de vencimiento del CAE
se imprime en 12 puntos. Esta plantilla esta limitada a facturas C del abono.
