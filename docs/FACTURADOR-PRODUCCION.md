# Preparar el facturador para produccion

Estado al 2 de noviembre de 2026: habilitacion pendiente. El usuario confirmo
que las facturas de noviembre de Valdes y Transitar siguen pendientes.
El certificado de produccion ya fue obtenido y verificado localmente: coincide
con el CUIT del emisor y con la clave preparada. Vence el 1 de noviembre de 2028.
Se guardo una copia privada en ~/.traveldocs-arca-produccion/certificado.pem.
Todavia falta asociarlo a wsfe y verificar el acceso; las emisiones realizadas
hasta ahora pertenecen a homologacion.

Esta guia prepara el acceso. No habilita por si sola la emision real: el codigo
de la rama sigue restringido a ARCA test y Firebase aislado. La conexion,
configuracion, prueba completa y publicacion deben completarse antes de emitir.
Main y los servicios de produccion no se modificaron durante estas pruebas.

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
2. Revisar ABM de puntos de venta. Para el monotributista corresponde el sistema
   Factura Electronica - Monotributo - Webservices. El punto de Comprobantes en
   Linea es otro sistema; no asumir que sirve para esta integracion.
3. Si hace falta, crear uno con un numero libre. Registrar el numero elegido;
   no asumir que sera 1 o 2.
4. Confirmar mediante consultas de solo lectura que ARCA permite acceder al
   servicio y consultar el punto y su ultimo numero autorizado.

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
