export function billingErrorText(error = {}) {
  if (!error || typeof error !== 'object') error = {};
  const code = typeof error.code === 'string' ? error.code : '';
  if (error.status === 401) return 'Tu sesion vencio. Volve a ingresar antes de continuar con la facturacion.';
  if (error.status === 403) return 'Tu usuario no tiene los permisos necesarios para esta operacion de facturacion.';
  if (code === 'ARCA_AUTHENTICATION_ERROR') return 'ARCA no acepto el acceso. Hay que revisar el certificado y la autorizacion de Facturacion Electronica.';
  if (code === 'ARCA_CONFIGURATION_ERROR') return 'Falta completar la configuracion del facturador: certificado, CUIT y punto de venta.';
  if (['ARCA_TRANSPORT_ERROR', 'ARCA_INVALID_SOAP_RESPONSE', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(code) || ['TimeoutError', 'AbortError'].includes(error.name)) {
    return 'No pudimos obtener una respuesta de ARCA. Si estabas emitiendo, la factura podria haberse autorizado. Usa Consultar ARCA antes de reintentar.';
  }
  if (error.name === 'TypeError') return 'No pudimos conectar con el facturador. Revisa tu conexion. Si estabas emitiendo, consulta el estado antes de reintentar.';
  if (code === 'ARCA_LOCK_TIMEOUT') return 'Hay otra operacion de facturacion en curso. Espera un momento y consulta el estado antes de continuar.';
  if (['ARCA_INPUT_IDEMPOTENCY_MISMATCH', 'ARCA_INPUT_RESERVATION_NOT_FOUND'].includes(code)) return 'La solicitud no coincide con su registro y necesita una revision. No generes otra factura para reemplazarla.';
  if (code.startsWith('ARCA_INPUT_')) return error.field === 'items'
    ? 'Falta el detalle del servicio. Revisa la descripcion y el importe antes de emitir.'
    : 'Hay un dato de la factura que falta o no es valido. Revisa la ficha, las fechas y el importe antes de confirmar.';
  if (['ARCA_SERVICE_ERROR', 'ARCA_SOAP_FAULT'].includes(code)) return 'ARCA no pudo procesar la operacion. Consulta el estado antes de reintentar. Si persiste, hay que revisar la conexion con ARCA.';
  // Los errores HTTP propios llegan sanitizados; nunca mostrar mensajes crudos del SDK.
  if (typeof error.error === 'string' && error.error !== 'Error desconocido.') return error.error;
  if (error.name === 'Error' && [400, 404, 409, 503].includes(error.status)) return error.message;
  return 'No pudimos completar la operacion. Consulta el estado de la factura antes de volver a emitir.';
}

export function billingOutcomeText(invoice) {
  if (['authorized', 'draft'].includes(invoice.status)) return '';
  if (invoice.status === 'rejected') {
    const missingDetail = invoice.outcome?.issues?.some(issue => /al menos una l[ií]nea de detalle/i.test(issue.message || ''));
    return missingDetail ? 'Falta el detalle del servicio. Revisa la descripcion y el importe antes de emitir.'
      : 'ARCA no autorizo esta factura. Revisa el detalle indicado, corrige los datos y prepara una nueva vista previa.';
  }
  if (invoice.status === 'issuing') return 'La solicitud quedo pendiente. Todavia no sabemos si ARCA autorizo la factura. Usa Consultar ARCA antes de volver a emitir.';
  if (invoice.status === 'indeterminate' && invoice.outcome?.lookup?.kind === 'not_found') return 'La consulta no encontro el comprobante. Usa Reintentar desde esta misma factura; no crees otra para reemplazarla.';
  if (invoice.status === 'indeterminate' && !['blocked', 'superseded'].includes(invoice.outcome?.lookup?.kind)) return 'No se pudo confirmar el resultado. Usa Consultar ARCA mas tarde antes de volver a emitir.';
  return 'El comprobante requiere revision de su numeracion o resultado. No generes otra factura ni borres el intento pendiente.';
}
