import { billingErrorText, billingOutcomeText } from './billing-feedback.mjs';
import { SALE_CONDITIONS } from './billing-form.mjs';
import { fmtDate } from '../compartido/utils.js';
import { esc, showConfirmDialog } from '../compartido/ui.mjs';
import { cargarPdfjs } from '../compartido/pdf.mjs';
import { adminFetch } from '../administracion/api.mjs';


let _billingInvoices = [];
const billingRequest = (body, endpoint = 'billing-api') => adminFetch('', { method: 'POST', body: JSON.stringify(body) }, endpoint);
function showBillingError(error) {
  const feedback = document.getElementById('admin-billing-feedback');
  feedback.textContent = billingErrorText(error);
  feedback.hidden = false;
  feedback.focus();
}
function clearBillingError() { document.getElementById('admin-billing-feedback').hidden = true; }
const billingMoney = invoice => new Intl.NumberFormat('es-AR', { style: 'currency', currency: invoice.input.currency }).format(invoice.input.items[0].amount / 100);

async function loadBillingInvoices() {
  const message = document.getElementById('admin-billing-message');
  message.textContent = 'Cargando facturas...';
  try {
    const result = await billingRequest({ action: 'list' });
    _billingInvoices = result.invoices;
    const labels = { draft: 'Borrador', issuing: 'Consultar resultado', authorized: 'Autorizada', rejected: 'Rechazada', indeterminate: 'Requiere consulta', conflict: 'Conflicto: requiere revision' };
    document.getElementById('admin-billing-tbody').innerHTML = _billingInvoices.map(invoice => `<tr>
      <td>${esc(invoice.receiver.legalName)}</td><td>${esc(invoice.period)}</td><td>${esc(billingMoney(invoice))}</td>
      <td>${esc(labels[invoice.status] || invoice.status)}${invoice.lastError || billingOutcomeText(invoice) ? `<p class="billing-status-message">${esc(invoice.lastError || billingOutcomeText(invoice))}</p>` : ''}${invoice.outcome?.issues?.length ? `<details class="billing-technical"><summary>Ver detalle de ARCA</summary><p>${esc(invoice.outcome.issues.map(issue => issue.message || issue.code).join('; '))}</p></details>` : ''}</td>
      <td>${invoice.status === 'authorized' ? `<button class="btn btn-ghost btn-sm" data-billing-view="${esc(invoice.id)}">Vista previa</button><button class="btn btn-ghost btn-sm" data-billing-pdf="${esc(invoice.id)}">Descargar PDF</button>` : ''}
      ${invoice.status === 'draft' || invoice.status === 'rejected' ? `<button class="btn btn-ghost btn-sm" data-billing-preview="${esc(invoice.agencyId)}">${invoice.status === 'rejected' ? 'Revisar correccion' : 'Vista previa'}</button>` : ''}
      ${['issuing', 'indeterminate'].includes(invoice.status) ? `<button class="btn btn-ghost btn-sm" data-billing-recover="${esc(invoice.id)}">Consultar ARCA</button>` : ''}
      ${invoice.status === 'indeterminate' && invoice.outcome?.lookup?.kind === 'not_found' ? `<button class="btn btn-ghost btn-sm" data-billing-retry="${esc(invoice.id)}">Reintentar</button>` : ''}</td></tr>`).join('');
    message.textContent = _billingInvoices.length ? '' : 'Todavia no hay facturas en este entorno.';
  } catch (err) { message.textContent = 'No se pudo actualizar el historial.'; showBillingError(err); }
}

async function previewBilling(agencyId) {
  clearBillingError();
  try {
    const saleCondition = document.querySelector(`[data-billing-condition="${CSS.escape(agencyId)}"]`)?.value;
    const invoice = await billingRequest({ action: 'preview', agencyId, saleCondition });
    if (invoice.status !== 'draft') {
      if (invoice.status === 'authorized') await showBillingPdfPreview(invoice);
      else showBillingError({ error: billingOutcomeText(invoice) || 'Ya existe un intento para este mes. Revisa su estado en el historial.' });
      await loadBillingInvoices();
      return;
    }
    await confirmBilling(invoice, 'issue');
  } catch (err) { showBillingError(err); }
}

function confirmBilling(invoice, action) {
  if (action === 'issue') return showBillingPdfPreview(invoice);
  const real = invoice.environment === 'production';
  showConfirmDialog({
    title: real ? 'Vista previa - Factura C real' : 'Vista previa - Factura C de prueba',
    message: `${invoice.receiver.legalName}, CUIT ${invoice.receiver.taxId}. ${invoice.receiver.address}. Condicion: ${invoice.receiver.condition}. Concepto: Servicios. Condicion de venta: ${invoice.receiver.saleCondition || SALE_CONDITIONS[0]}. Servicio TravelDocs del mes ${invoice.period}. Total: ${billingMoney(invoice)} (${invoice.input.currency}).`,
    subtext: `Punto de venta: ${invoice.input.salesPoint || ''}. Desde, hasta y vencimiento: ${fmtDate(invoice.input.date)}. ${invoice.quotation ? `Cotizacion ARCA: ${invoice.quotation.rate}, fecha ${invoice.quotation.date}. Pago en USD.` : ''} ${real ? 'Se solicitara a ARCA una factura con validez fiscal.' : 'Sin valor fiscal.'}`,
    confirmLabel: action === 'retry' ? 'Confirmar reintento' : real ? 'Emitir factura real' : 'Emitir prueba',
    onConfirm: () => runBilling(action, invoice),
  });
}

let _billingPreviewVersion = 0;
let _billingPreviewUrl = null;
let billingPreviewDialog;

async function showBillingPdfPreview(invoice) {
  if (billingPreviewDialog.open || !['draft', 'authorized'].includes(invoice.status)) return;
  const authorized = invoice.status === 'authorized';
  const version = ++_billingPreviewVersion;
  const status = document.getElementById('billing-preview-status');
  const issue = document.getElementById('billing-preview-issue');
  document.getElementById('billing-preview-title').textContent = authorized ? 'Factura C autorizada' : 'Vista previa de la factura';
  document.getElementById('billing-preview-summary').textContent = `${invoice.receiver.legalName}. ${billingMoney(invoice)} (${invoice.input.currency}). Mes ${invoice.period}. ${invoice.receiver.saleCondition || SALE_CONDITIONS[0]}.`;
  status.textContent = authorized ? 'Cargando PDF de la factura autorizada...' : 'Preparando PDF del borrador. Todavia no se emitio ninguna factura.';
  document.getElementById('billing-preview-download').textContent = authorized ? 'Descargar PDF' : 'Descargar borrador';
  issue.textContent = invoice.environment === 'production' ? 'Emitir factura real' : 'Emitir prueba';
  issue.hidden = authorized;
  issue.disabled = true;
  issue.onclick = authorized ? null : () => { billingPreviewDialog.close(); runBilling('issue', invoice); };
  billingPreviewDialog.showModal();
  document.body.style.overflow = 'hidden';
  try {
    const result = await billingRequest(authorized ? { invoiceId: invoice.id } : { invoiceId: invoice.id, preview: true, digest: invoice.digest }, 'billing-pdf');
    if (version !== _billingPreviewVersion) return;
    const bytes = Uint8Array.from(atob(result.pdf), c => c.charCodeAt(0));
    _billingPreviewUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    for (const id of ['billing-preview-open', 'billing-preview-download']) {
      const link = document.getElementById(id);
      link.href = _billingPreviewUrl;
      link.hidden = false;
    }
    document.getElementById('billing-preview-download').download = result.filename;
    const pdfjs = await cargarPdfjs();
    if (version !== _billingPreviewVersion) return;
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${authorized ? 'Factura autorizada' : 'Borrador de factura'}. Los datos figuran tambien en el PDF descargable.`);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      if (version !== _billingPreviewVersion) return;
      document.getElementById('billing-preview-canvas').replaceChildren(canvas);
      status.textContent = authorized ? (invoice.environment === 'production' ? 'Factura autorizada. CAE y QR incluidos en el PDF.' : 'Factura de prueba autorizada, sin valor fiscal.') : 'Borrador sin valor fiscal. El numero, CAE y QR se agregan al emitir.';
      issue.disabled = authorized;
    } finally { await pdf.destroy(); }
  } catch (err) {
    if (version !== _billingPreviewVersion) return;
    status.textContent = _billingPreviewUrl ? 'No pudimos mostrar el visor. Usa Abrir PDF o el enlace de descarga para revisar la factura.' : billingErrorText(err);
    issue.disabled = authorized || !_billingPreviewUrl;
  }
}

async function runBilling(action, invoice) {
  clearBillingError();
  try {
    const result = await billingRequest({ action, invoiceId: invoice.id, digest: invoice.digest });
    const message = billingOutcomeText(result);
    if (message) showBillingError({ error: message });
  } catch (err) { showBillingError(err); }
  await loadBillingInvoices();
}

async function downloadBillingPdf(id) {
  clearBillingError();
  try {
    const result = await billingRequest({ invoiceId: id }, 'billing-pdf');
    const blob = new Blob([Uint8Array.from(atob(result.pdf), c => c.charCodeAt(0))], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = result.filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) { showBillingError({ ...err, error: err.error || 'No pudimos descargar el PDF. La factura guardada se conserva; no vuelvas a emitirla.' }); }
}

function billingStatusLabel(status) {
  if (status.state === 'trial') return `Prueba gratis hasta ${fmtDate(status.trialEndsOn)}`;
  if (status.state === 'incomplete') return 'Ficha fiscal incompleta';
  if (status.state === 'scheduled') return `Facturacion desde ${status.firstPeriod}`;
  if (status.state === 'ready') return 'Habilitada para facturar';
  if (status.state === 'suspended') return 'Facturacion suspendida';
  return 'Revisar fecha de alta';
}
export function initFacturacion() {
  billingPreviewDialog = document.getElementById('billing-preview-dialog');

  billingPreviewDialog.addEventListener('close', () => {
    _billingPreviewVersion++;
    if (_billingPreviewUrl) {
      const url = _billingPreviewUrl;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      _billingPreviewUrl = null;
    }
    document.getElementById('billing-preview-canvas').replaceChildren();
    document.getElementById('billing-preview-issue').onclick = null;
    for (const id of ['billing-preview-open', 'billing-preview-download']) {
      const link = document.getElementById(id);
      link.hidden = true;
      link.removeAttribute('href');
    }
    if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
  });

  document.getElementById('admin-billing-refresh')?.addEventListener('click', loadBillingInvoices);

  // Delegación para acciones en tablas
  document.addEventListener('click', e => {
    const preview = e.target.closest('[data-billing-preview]');
    if (preview) { previewBilling(preview.dataset.billingPreview); return; }
    const view = e.target.closest('[data-billing-view]');
    if (view) { const invoice = _billingInvoices.find(i => i.id === view.dataset.billingView); clearBillingError(); if (invoice) showBillingPdfPreview(invoice).catch(showBillingError); return; }
    const pdf = e.target.closest('[data-billing-pdf]');
    if (pdf) { downloadBillingPdf(pdf.dataset.billingPdf); return; }
    const recover = e.target.closest('[data-billing-recover]');
    if (recover) { const invoice = _billingInvoices.find(i => i.id === recover.dataset.billingRecover); if (invoice) runBilling('recover', invoice); return; }
    const retry = e.target.closest('[data-billing-retry]');
    if (retry) { const invoice = _billingInvoices.find(i => i.id === retry.dataset.billingRetry); if (invoice) confirmBilling(invoice, 'retry'); return; }
  });
}

export { loadBillingInvoices, billingStatusLabel };
