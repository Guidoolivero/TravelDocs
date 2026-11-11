# Preparar el facturador para produccion

Estado al 2 de noviembre de 2026: PR #4 aprobado e integrado; configuracion real
cargada con autorizacion del usuario. Falta verificar el circuito desde el panel
tras corregir el arranque del PDF empaquetado. El usuario creo el punto 00002, TravelDocs, con modalidad
Factura Electronica - Monotributo - Web Services desde Registro Unico Tributario.
La consulta de produccion devuelve el punto 2 sin bloqueo y el proximo numero
para Factura C es 1. Es una consulta, no una reserva de numeracion. Tambien se
consulto la cotizacion USD: 1534, fecha 20261030; debe volver a consultarse al emitir.
No se emitieron comprobantes reales.

Certificado de produccion verificado: corresponde al CUIT del emisor y a la clave
local; vence el 1 de noviembre de 2028. Esta autorizado para wsfe y se conserva en
~/.traveldocs-arca-produccion/, junto al store persistente usado para las consultas.
El usuario termino el tramite en ARCA y aporto su constancia de monotributo.
Confirmo noviembre de 2026 como primer mes en TravelDocs para Valdes y Transitar,
sin recuperar meses anteriores, y mantener su CUIT en el campo Ingresos Brutos.

El modo produccion esta publicado con habilitacion explicita y separacion de
comprobantes, claves de idempotencia y etiquetas. Se cargaron las credenciales
privadas y las fichas iniciales en Firebase real. La emision sigue siendo manual.

La consulta de USD usa una fecha anterior a la emision. ARCA devuelve 602 en
dias sin cotizacion; se retrocede hasta diez dias y se interrumpe ante cualquier
otro error. El SDK 0.25.2 omite FchCotiz en su API publica: postinstall aplica una
adaptacion acotada y comprobada antes del build. Una nueva version exige revisar
esa adaptacion. No se acepta la cotizacion del mismo dia para evitar el rechazo
10038 en pagos en la misma moneda extranjera.

El 2 de noviembre se prepararon borradores reales de Valdes ARS 60.000 y
Transitar USD 100 con el servicio corregido, sin solicitar CAE. ARCA devolvio
1534, fecha 20261030, para Transitar. Falta confirmar manualmente para emitir.

Vista previa abre el PDF del borrador dentro del panel. Se puede abrir aparte o
descargar con Descargar borrador. Conserva los datos y el diseño de la factura,
con la leyenda BORRADOR - SIN VALOR FISCAL y sin numero definitivo, CAE ni QR.
Emitir factura real es una accion separada. Cuando ARCA autoriza el comprobante,
el historial ofrece Vista previa y Descargar PDF con su numero, CAE y QR.
Vista previa de una autorizada abre el mismo visor sin accion de emision. El
boton de la agencia tambien abre la factura ya emitida del mes. Descargar no emite.

El 3 de noviembre el usuario emitio ambas facturas y aporto sus PDF. Se revisaron
la presentacion en una hoja, los importes confirmados, fechas, numeracion, CAE y
QR presentes. No se realizo otra consulta de validacion contra ARCA.

React PDF se carga mediante import() desde CommonJS. Lambda deshabilita require
de ESM en Node 22; probar solo con el valor predeterminado de Node local no cubre
esa restriccion. La regresion genera un PDF con --no-experimental-require-module;
el smoke del paquete usa la misma opcion. Referencia: [runtime de AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html).

## Certificado

1. Ingresar a ARCA con clave fiscal y verificar el contribuyente representado.
   Debe coincidir con el emisor confirmado en los comprobantes anteriores.
2. Abrir Administracion de Certificados Digitales. Si falta el servicio, adherirlo
   mediante el Administrador de Relaciones de Clave Fiscal.
3. Agregar alias `TravelDocsProduccion` y adjuntar
   `~/Downloads/TravelDocsProduccion.csr`.
4. Entrar al detalle del alias y descargar el certificado CRT. Registrar donde
   se guardo; no pegar la clave privada ni contrasenas en el chat.
5. Verificar localmente que el certificado corresponda a la clave, al CUIT y al
   ambiente esperado, y registrar su vencimiento antes de configurarlo.

La clave privada y la solicitud originales se prepararon en
`~/.traveldocs-arca-produccion/`, separadas de homologacion. El CSR de Descargas
se verifico contra esa solicitud. Nunca subir la clave a un repositorio ni a public.

## Autorizacion y punto de venta

1. En el Administrador de Relaciones, asociar el computador fiscal/certificado
   con el servicio de Facturacion Electronica `wsfe` para el emisor correcto.
2. Revisar Registro Unico Tributario > Puntos de venta > Modificar datos.
   El acceso PVE mostro un selector vacio en Safari y Chrome. El recorrido desde
   Registro Unico Tributario permitio completar el alta. Para el monotributista
   corresponde el sistema Factura Electronica - Monotributo - Webservices. El punto de Comprobantes en
   Linea es otro sistema; no asumir que sirve para esta integracion.
3. Si hace falta, crear uno con un numero libre. Registrar el numero elegido;
   no asumir que sera 1 o 2.
4. Verificado mediante consulta de solo lectura: punto 2 sin bloqueo; proximo
   numero de Factura C: 1. Consultar nuevamente antes de la primera emision.

## Configuracion tecnica

La activacion necesita estas variables disponibles en Functions, solo en contexto production:

- BILLING_ENABLED=true y ARCA_ENVIRONMENT=production.
- BILLING_FIREBASE_PROJECT_ID=tradingdocs-mt y service account del mismo proyecto.
- ARCA_TAX_ID con el CUIT confirmado; ARCA_SALES_POINT=2.
- BILLING_PRODUCTION_CONFIRMATION con el valor CUIT:2, reemplazando CUIT por el
  numero sin guiones. No activa envios ni cron.
- BILLING_ISSUER_JSON con legalName, address, grossIncome y activitiesStartDate
  revisados. El campo grossIncome conserva el CUIT, por indicacion del usuario.

El plan actual de Netlify rechaza limitar variables al scope Functions (403).
El usuario autorizo usar los scopes estandar para estas siete variables el
2 de noviembre. Los valores se guardaron solo en production y se verificaron
mediante lectura posterior de la API. CUIT, confirmacion y datos del emisor
son legibles desde la administracion de Netlify. Certificado y clave privada
permanecen exclusivamente en billingSecrets/production.
Despues de cambiar variables hay que volver a desplegar; un deploy anterior
no recibe automaticamente la nueva configuracion.

El bundle fija BILLING_BUILD_CONTEXT al valor de CONTEXT durante la compilacion.
No depende de que CONTEXT exista en Functions: Netlify no lo ofrece alli.
Un deploy preview no permite produccion aunque herede variables de activacion.
No configurar estos valores en netlify.toml: no se propagan al runtime.

El certificado y la clave de produccion se leen exclusivamente del documento
privado billingSecrets/production, mediante Admin SDK, con los campos taxId,
salesPoint (numero), certificatePem y privateKeyPem. El CUIT y punto deben
coincidir con la configuracion. No hay endpoint para leerlos o modificarlos.
Las reglas actuales deniegan todo acceso del navegador, incluidos administradores.
Esto evita agregar ambos PEM al conjunto de variables de Lambda, limitado a 4 KB.
Homologacion conserva las variables PEM y Firebase aislado existentes.

Preparar esa carga con una herramienta local de Admin SDK, sin copiar los PEM al
repositorio, a public, a argumentos de shell ni a logs. Revisar y aplicar solo con
autorizacion de activacion. La carga se realizo el 2 de noviembre despues de
respaldar la carpeta privada completa en ~/.traveldocs-arca-produccion/backups/.

Los tickets WSAA consultados localmente deben conservarse al pasar al store
Firestore; un store vacio con el mismo certificado puede dar alreadyAuthenticated.
Para el SDK fijado en esta rama, cada archivo de sdk-store tiene como nombre el
SHA256 de su clave: coincide con el id del documento billingStore. Importar los
valores opacos con ese mismo id, sin sobrescribir documentos existentes. No copiar
locks de archivos ni datos de homologacion. Dejar de usar el store local como
cliente activo al realizar el traspaso. Se importo un ticket sin sobrescrituras y
se verifico el acceso a ARCA usando el store Firestore el 2 de noviembre.

## Corte inicial de agencias existentes

scripts/facturacion/import-initial-billing.mjs lee un manifiesto privado con period y agencies;
cada entrada contiene agencyId y profile (los mismos campos validados de la ficha).
El manifiesto privado se aplico el 2 de noviembre y tiene respaldo fuera del repo.
Los ids y fechas de alta se contrastaron con el listado real del
panel: ambas agencias estan activas y su prueba de 30 dias termino antes de noviembre.
El usuario confirmo los importes de noviembre; los datos fiscales se tomaron de
los snapshots privados de sus comprobantes anteriores. El emisor se preparo en
/private/tmp/facturador-emisor.json. Ninguno de esos archivos va al repositorio.
La carga contrasto nuevamente las agencias y comprobo ausencia de fichas y
comprobantes previos. Valdes quedo en ARS 60.000 y Transitar en USD 100 desde noviembre.

La revision automatica rechazo extraer la credencial Firebase de Netlify a un
archivo local. No se ejecuto esa copia ni se reintento por otra via. El contraste
se completo desde el panel autenticado. Para la activacion autorizada se uso
la credencial solo en memoria, sin guardarla en un archivo ni mostrarla en logs.

Con credenciales de Admin SDK, el comando sin flags solo consulta y valida:

```sh
node scripts/facturacion/import-initial-billing.mjs /ruta/privada/corte.json
```

Despues de revisar el resultado y autorizar la carga, --apply incorpora todas las
fichas en una transaccion. El script rechaza agencias gratuitas, suspendidas,
eliminadas, repetidas, sin fecha, con ficha previa o comprobantes existentes.
Solo permite el mes actual. No modifica la creacion de la agencia, no importa
historial y no emite. initialPeriod registra el corte confirmado, y enabledOn
registra el dia real de incorporacion. Una reactivacion o una ficha incompleta
eliminan esa excepcion y vuelven a las reglas del siguiente inicio de mes.
Los cambios de precio conservan el valor pendiente del mes actual.

## Antes de la primera factura real

- Verificar el circuito publicado desde el panel autenticado.
  No copiar variables de produccion a la demo ni activar envio automatico.
- Verificar la ficha fiscal, importe vigente y primer mes facturable de cada
  agencia. Las fechas sembradas en emulador eran casos de prueba.
- Revisar que el periodo no haya sido facturado manualmente. Conservar el corte
  inicial y el historial; una clave del sistema no detecta por si sola una factura
  emitida antes desde el portal de ARCA.
- Revisar receptor, moneda, cotizacion, fechas y condicion de venta antes de la
  primera confirmacion. Debe ser una factura real debida, no una prueba fiscal.
- Conservar respaldos del certificado, clave, tickets, reservas y snapshots en
  ubicaciones privadas; registrar el procedimiento de renovacion y correccion.

Fuentes oficiales:

- https://www.afip.gob.ar/ws/documentacion/wsaa.asp
- https://www.afip.gob.ar/ws/WSAA/WSAA.ObtenerCertificado.pdf
- https://www.afip.gov.ar/facturacion/documentos/puntos-de-venta.pdf

- https://docs.netlify.com/build/functions/environment-variables/
