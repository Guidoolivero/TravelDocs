# Preparar el facturador para produccion

Estado al 2 de noviembre de 2026: acceso de ARCA verificado, activacion de
TravelDocs pendiente. El usuario creo el punto 00002, TravelDocs, con modalidad
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

La rama ya implementa el modo produccion con habilitacion explicita y separacion
de comprobantes, claves de idempotencia y etiquetas. Falta configurar y verificar
el entorno conectado antes de publicar. Main, Firebase y Netlify de produccion
siguen sin cambios. No se cargaron credenciales ni fichas en Firebase real.

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

## Configuracion tecnica pendiente

La activacion necesita estas variables de Functions, solo en contexto production:

- BILLING_ENABLED=true y ARCA_ENVIRONMENT=production.
- BILLING_FIREBASE_PROJECT_ID=tradingdocs-mt y service account del mismo proyecto.
- ARCA_TAX_ID con el CUIT confirmado; ARCA_SALES_POINT=2.
- BILLING_PRODUCTION_CONFIRMATION con el valor CUIT:2, reemplazando CUIT por el
  numero sin guiones. No activa envios ni cron.
- BILLING_ISSUER_JSON con legalName, address, grossIncome y activitiesStartDate
  revisados. El campo grossIncome conserva el CUIT, por indicacion del usuario.

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
autorizacion de activacion. Respaldar la carpeta privada completa antes de mover
credenciales. No se ha realizado esta carga.

Los tickets WSAA consultados localmente deben conservarse al pasar al store
Firestore; un store vacio con el mismo certificado puede dar alreadyAuthenticated.
Para el SDK fijado en esta rama, cada archivo de sdk-store tiene como nombre el
SHA256 de su clave: coincide con el id del documento billingStore. Importar los
valores opacos con ese mismo id, sin sobrescribir documentos existentes. No copiar
locks de archivos ni datos de homologacion. Dejar de usar el store local como
cliente activo al realizar el traspaso. No se ha realizado este traspaso.

## Corte inicial de agencias existentes

scripts/import-initial-billing.mjs lee un manifiesto privado con period y agencies;
cada entrada contiene agencyId y profile (los mismos campos validados de la ficha).
El manifiesto privado quedo preparado en /private/tmp/facturador-corte-inicial.json,
sin aplicarlo. Los ids y fechas de alta se contrastaron con el listado real del
panel: ambas agencias estan activas y su prueba de 30 dias termino antes de noviembre.
El usuario confirmo los importes de noviembre; los datos fiscales se tomaron de
los snapshots privados de sus comprobantes anteriores. El emisor se preparo en
/private/tmp/facturador-emisor.json. Ninguno de esos archivos va al repositorio.
La transaccion debe contrastar nuevamente las agencias y comprobar ausencia de
fichas/comprobantes previos antes de aplicar.

La revision automatica rechazo extraer la credencial Firebase de Netlify a un
archivo local. No se ejecuto esa copia ni se reintento por otra via. El contraste
se completo desde el panel autenticado; no hizo falta copiar el secreto.

Con credenciales de Admin SDK, el comando sin flags solo consulta y valida:

```sh
node scripts/import-initial-billing.mjs /ruta/privada/corte.json
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

- Completar la configuracion y publicar el circuito revisado con autorizacion.
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
