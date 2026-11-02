const { createElement: h } = require('react');
const { Document, Page, View: V, Text: T, Image, Svg, Path, Polygon, Font, StyleSheet, renderToBuffer } = require('@react-pdf/renderer');
const QRCode = require('qrcode');
const path = require('node:path');

// Fuentes locales: el PDF no depende de Google Fonts ni de imagenes remotas.
for (const [family, file, weight] of [
  ['Plex', 'IBMPlexSans-Regular.ttf', 400], ['Plex', 'IBMPlexSans-SemiBold.ttf', 600],
  ['Plex Condensed', 'IBMPlexSansCondensed-Bold.ttf', 700],
]) Font.register({ family, src: path.join(process.cwd(), 'netlify/functions/lib/invoice-fonts', file), fontWeight: weight });
Font.registerHyphenationCallback(word => [word]);
const c = { ink: '#102b4e', soft: '#30465f', navy: '#092a50', blue: '#124b86', teal: '#0c8f91', coral: '#ff6846', yellow: '#ffb14a', white: '#ffffff', line: '#dbe4ea', wash: '#f2f6f8', sky: '#d9f1f1', header: '#174b73', outline: '#7990a8', footer: '#fbfcfc', recipient: '#f7fcfc', operation: '#fffaf8' };
const s = StyleSheet.create({
  page: { fontFamily: 'Plex', fontSize: 9, color: c.ink, paddingBottom: 126 },
  row: { flexDirection: 'row', alignItems: 'center' },
  ribbon: { height: 6, flexDirection: 'row' },
  header: { height: 104, backgroundColor: c.navy, paddingHorizontal: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.coral, alignItems: 'center', justifyContent: 'center' },
  wordmark: { fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 21, color: c.white },
  title: { fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 23, color: c.white },
  letter: { width: 38, height: 43, border: `0.7 solid ${c.outline}`, borderRadius: 8, textAlign: 'center', paddingTop: 5, fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 25, color: c.white },
  kicker: { color: c.teal, fontSize: 6.8, fontWeight: 600, letterSpacing: 1.2, marginBottom: 5 },
  heading: { fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 14 },
  bold: { fontWeight: 600 },
  issuer: { flexDirection: 'row', gap: 22, paddingVertical: 17, paddingHorizontal: 36, borderBottom: `0.6 solid ${c.line}` },
  issuerMain: { width: 165 },
  issuerDetails: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  detail: { width: '46%', paddingLeft: 7, borderLeft: `1 solid ${c.sky}` },
  label: { fontSize: 7.5, color: c.soft, marginBottom: 2 },
  meta: { flexDirection: 'row', gap: 12, marginHorizontal: 36, marginTop: 18 },
  card: { flex: 1, padding: 15, borderRadius: 11, border: `0.7 solid ${c.line}`, minHeight: 140 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 },
  step: { width: 19, height: 19, borderRadius: 6, textAlign: 'center', paddingTop: 4, color: c.white, fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 7 },
  recipient: { fontSize: 9 },
  operationRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, paddingBottom: 4, marginBottom: 5, borderBottom: `0.4 dashed ${c.line}`, fontSize: 7.5 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 36, marginTop: 15 },
  rule: { height: 0.6, flex: 1, backgroundColor: c.line },
  services: { marginHorizontal: 36, marginTop: 18 },
  serviceHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 13 },
  currency: { flexDirection: 'row', alignItems: 'baseline', gap: 5, fontSize: 7.5 },
  table: { border: `0.7 solid ${c.line}`, borderRadius: 9, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, gap: 8, borderBottom: `0.4 solid ${c.line}` },
  tableHead: { backgroundColor: c.navy, color: c.white, fontSize: 7, paddingVertical: 8, fontWeight: 600 },
  description: { width: '52%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  qty: { width: '8%', textAlign: 'right' },
  price: { width: '20%', textAlign: 'right' },
  amount: { width: '20%', textAlign: 'right', fontWeight: 600 },
  serviceIcon: { width: 23, height: 23, borderRadius: 7, backgroundColor: c.sky, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', gap: 26, marginHorizontal: 36, marginTop: 17, padding: 16, borderRadius: 10, backgroundColor: c.wash },
  payment: { flex: 1 },
  totals: { width: 200 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingBottom: 10 },
  grand: { borderTop: `0.7 solid ${c.line}`, paddingTop: 11, alignItems: 'baseline' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTop: `0.7 solid ${c.line}`, backgroundColor: c.footer, paddingVertical: 15, paddingHorizontal: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerFiscal: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  footerDate: { fontSize: 12, marginTop: 4 },
});
const plane = 'M34.8 8.7c1.5-1.5 3.8-1.6 5-.4 1.2 1.2 1 3.5-.4 5L27.9 24.8l2.6 11.8-3.2 3.2-5.6-9-7.2 7.2-1 4-2.4 2.4-1.6-8-8-1.6 2.4-2.4 4-1 7.2-7.2-9-5.6 3.2-3.2 11.8 2.6L34.8 8.7Z';
const icon = (color = c.white, size = 23) => h(Svg, { width: size, height: size, viewBox: '0 0 44 44' }, h(Path, { d: plane, fill: color }));
const date = iso => iso ? iso.split('-').reverse().join('/') : '';
const taxId = id => /^\d{11}$/.test(id || '') ? id.slice(0, 2) + '-' + id.slice(2, 10) + '-' + id.slice(10) : id;
function formatInvoiceAmount(minor) {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return (minor < 0 ? '-' : '') + digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + digits.slice(-2);
}
const decimal = value => { const [whole, fraction = ''] = value.split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + fraction.padEnd(2, '0'); };
const heading = (number, eyebrow, title, color) => h(V, { style: s.cardHeading }, h(T, { style: [s.step, { backgroundColor: color }] }, number), h(V, null, h(T, { style: [s.kicker, { marginBottom: 1 }] }, eyebrow), h(T, { style: s.heading }, title)));
const detail = (label, value) => h(V, { style: s.detail }, h(T, { style: s.label }, label), h(T, { style: s.bold }, value));
const operation = (label, value) => h(V, { style: s.operationRow }, h(T, { style: { color: c.soft } }, label), h(T, { style: { fontWeight: 600, textAlign: 'right', maxWidth: '65%' } }, value));

async function renderTravelDocsPdf(doc, { period, notice = 'HOMOLOGACION - SIN VALOR FISCAL' } = {}) {
  // shortcut: esta plantilla es para las facturas C del abono; ampliar al incorporar otros comprobantes.
  if (doc.voucherClass !== 'C' || doc.title !== 'FACTURA') throw new Error('La plantilla requiere una factura C.');
  const qr = await QRCode.toDataURL(doc.qr, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
  const currency = doc.currency.id === 'DOL' ? 'USD' : 'ARS';
  const money = minor => currency + ' ' + formatInvoiceAmount(minor);
  const row = (label, amount) => h(V, { style: s.totalRow }, h(T, { style: { color: c.soft } }, label), h(T, { style: s.bold }, money(amount)));
  const tree = h(Document, { title: 'Factura C ' + doc.number, author: doc.issuer.legalName, creator: 'TravelDocs' },
    h(Page, { size: 'A4', style: s.page },
      h(V, { style: s.ribbon }, ...[[c.coral, '25%'], [c.yellow, '17%'], [c.teal, '30%'], [c.blue, '28%']].map(([backgroundColor, width]) => h(V, { key: backgroundColor, style: { backgroundColor, width } }))),
      h(V, { style: s.header },
        h(Svg, { width: 230, height: 104, viewBox: '0 0 230 104', style: { position: 'absolute', left: 0, top: 0 } }, h(Polygon, { points: '0,0 230,0 155,104 0,104', fill: c.header })),
        h(V, { style: s.brand }, h(V, { style: s.mark }, icon()), h(T, { style: s.wordmark }, 'Travel', h(T, { style: { color: c.coral } }, 'Docs'))),
        h(V, { style: [s.row, { gap: 12 }] }, h(V, null, h(T, { style: s.letter }, doc.voucherClass), h(T, { style: { fontSize: 6.5, color: c.sky, marginTop: 4 } }, 'Codigo ' + doc.code)), h(V, null, h(T, { style: [s.kicker, { color: c.sky }] }, 'COMPROBANTE'), h(T, { style: s.title }, 'Factura'), h(T, { style: { color: c.sky, fontSize: 8, marginTop: 3, fontWeight: 600 } }, 'Nº ' + doc.number)))),
      h(V, { style: s.issuer }, h(V, { style: s.issuerMain }, h(T, { style: s.kicker }, 'EMISOR'), h(T, { style: [s.heading, { fontSize: 11, marginBottom: 4 }] }, doc.issuer.legalName), h(T, null, doc.issuer.address)),
        h(V, { style: s.issuerDetails }, detail('CUIT', taxId(doc.issuer.taxId)), detail('Ingresos Brutos', doc.issuer.grossIncome), detail('Inicio de actividades', date(doc.issuer.activitiesStartDate)), detail('Condicion fiscal', doc.issuer.conditionLegend))),
      h(V, { style: s.meta, wrap: false },
        h(V, { style: [s.card, { backgroundColor: c.recipient }] }, heading('01', 'FACTURADO A', 'Receptor', c.teal), h(V, { style: s.recipient }, h(T, { style: [s.heading, { fontSize: 11, marginBottom: 5 }] }, doc.receiver.name), h(T, null, (doc.receiver.document?.label || 'CUIT') + ': ' + taxId(doc.receiver.document?.number)), h(T, null, doc.receiver.conditionLegend), h(T, { style: { marginTop: 7 } }, doc.receiver.address))),
        h(V, { style: [s.card, { backgroundColor: c.operation }] }, heading('02', 'DETALLES', 'Operacion', c.coral), operation('Fecha de emision', date(doc.issueDate)), operation('Condicion de venta', doc.saleConditions), operation('Periodo facturado', doc.servicePeriod ? date(doc.servicePeriod.from) + ' al ' + date(doc.servicePeriod.to) : ''), operation('Vencimiento', date(doc.paymentDueDate)))),
      h(V, { style: s.notice }, h(V, { style: s.rule }), h(T, { style: { fontSize: 6.5, letterSpacing: 0.8, fontWeight: 600 } }, notice), h(V, { style: s.rule })),
      h(V, { style: s.services },
        h(V, { style: s.serviceHeading }, h(V, null, h(T, { style: s.kicker }, 'SERVICIOS'), h(T, { style: s.heading }, 'Detalle de la factura')), h(V, { style: s.currency }, h(T, null, 'Moneda'), h(T, { style: { fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 11, color: c.coral } }, currency), doc.currency.exchangeRate ? h(T, null, 'TC ' + decimal(doc.currency.exchangeRate)) : null)),
        h(V, { style: s.table }, h(V, { style: [s.tableRow, s.tableHead] }, h(T, { style: { width: '52%' } }, 'DESCRIPCION'), h(T, { style: s.qty }, 'CANT.'), h(T, { style: s.price }, 'PRECIO UNITARIO'), h(T, { style: s.amount }, 'SUBTOTAL')),
          ...doc.lines.map((line, index) => h(V, { key: index, style: s.tableRow, wrap: false }, h(V, { style: s.description }, h(V, { style: s.serviceIcon }, icon(c.teal, 15)), h(V, { style: { flex: 1 } }, h(T, { style: [s.bold, { fontSize: 9 }] }, line.description), period ? h(T, { style: { fontSize: 7, color: c.soft, marginTop: 3 } }, 'Gestion mensual - Periodo ' + period) : null)), h(T, { style: s.qty }, String(line.quantity).replace('.', ',')), h(T, { style: s.price }, currency + ' ' + decimal(line.unitPrice)), h(T, { style: s.amount }, money(line.amount)))))),
      h(V, { style: s.summary, wrap: false }, h(V, { style: s.payment }, h(T, { style: s.kicker }, 'FORMA DE PAGO'), h(T, { style: [s.heading, { fontSize: 11, marginBottom: 5 }] }, doc.saleConditions), h(T, { style: { fontSize: 8, color: c.soft } }, currency === 'USD' ? 'Comprobante emitido en dolares estadounidenses.' : 'Comprobante emitido en pesos argentinos.')),
        h(V, { style: s.totals }, row('Subtotal', doc.totals.subtotal), ...doc.totals.otherTaxes.map(tax => row(tax.description, tax.amount)), doc.totals.adjustment ? row('Ajuste', doc.totals.adjustment) : null, h(V, { style: [s.totalRow, s.grand] }, h(T, { style: s.bold }, 'Importe total'), h(T, { style: { fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 18, color: c.coral } }, h(T, { style: { fontSize: 8 } }, currency + ' '), formatInvoiceAmount(doc.totals.total))))),
      ...doc.legends.map((legend, index) => h(T, { key: index, style: { marginHorizontal: 36, marginTop: 8, fontSize: 8 } }, legend.text)),
      h(V, { style: s.footer, fixed: true }, h(V, { style: s.brand }, h(V, { style: [s.mark, { width: 23, height: 23, borderRadius: 7 }] }, icon(c.white, 16)), h(V, null, h(T, { style: { fontFamily: 'Plex Condensed', fontWeight: 700, fontSize: 9 } }, 'TravelDocs'), h(T, { style: { color: c.teal, fontSize: 7, marginTop: 4 } }, 'traveldocs.com.ar'))),
        h(V, { style: s.footerFiscal }, h(Image, { src: qr, style: { width: 76, height: 76 } }), h(V, null, h(T, { style: [s.kicker, { fontSize: 6 }] }, 'COMPROBANTE AUTORIZADO'), h(T, { style: { fontSize: 9, fontWeight: 600 } }, 'C.A.E. Nº ' + doc.authorization.code), h(T, { style: s.footerDate }, 'Fecha Vto.: ' + date(doc.authorization.dueDate)))))));
  return renderToBuffer(tree);
}
module.exports = { renderTravelDocsPdf, formatInvoiceAmount };
