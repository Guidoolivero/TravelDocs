// ============================================================
//  test-email-html.mjs — Test de render HTML via EmailJS (Fase 0)
//
//  Verifica que el template de EmailJS renderiza el HTML que le
//  pasamos en el parametro {{message}} (no lo escapa, no lo
//  envuelve en <pre>/texto plano) ANTES de construir el email
//  unificado de alertas.
//
//  Uso (credenciales en .env, gitignored):
//    node --env-file=.env scripts/test-email-html.mjs
//
//  Env vars:
//    EMAILJS_PUBLIC_KEY / EMAILJS_SERVICE_ID / EMAILJS_TEMPLATE_ID
//    TEST_TO_EMAIL  (destinatario de prueba)
//    PRIVATE_KEY    (clave privada de EmailJS; la cuenta tiene "strict mode"
//                    y el REST server-side la exige como accessToken)
// ============================================================

const publicKey = process.env.EMAILJS_PUBLIC_KEY;
const serviceId = process.env.EMAILJS_SERVICE_ID;
const templateId = process.env.EMAILJS_TEMPLATE_ID;
const to = process.env.TEST_TO_EMAIL;
const accessToken = process.env.PRIVATE_KEY;

if (!publicKey || !serviceId || !templateId || !to) {
  console.error('Faltan env vars: EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, TEST_TO_EMAIL.');
  process.exit(1);
}

// Mismo HTML que producira buildAlertEmail: Arial, titulos de seccion y
// tabla con columnas de ancho fijo + nombre largo para probar el wrap.
const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a1a1a;max-width:600px;margin:0 auto;">
  <p style="margin:0 0 14px 0;">Prueba de render HTML (test-email-html). Si ves columnas alineadas y tipografia Arial, el template renderiza OK.</p>

  <div style="border-left:4px solid #1a3a5c;padding:6px 10px;margin:0 0 8px 0;font-weight:bold;font-size:12px;letter-spacing:.06em;color:#1a3a5c;">VENCIMIENTOS</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;font-size:13px;">
    <tr style="background:#f2f4f7;color:#555;font-size:11px;text-transform:uppercase;">
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6ea;width:34%;">Pasajero</th>
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6ea;width:24%;">Documento</th>
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6ea;width:20%;">Numero</th>
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6ea;width:22%;">Vence</th>
    </tr>
    <tr>
      <td style="padding:6px 8px;border:1px solid #e3e6ea;word-break:break-word;">GARCIA FERNANDEZ DE LOS SANTOS, JUAN CARLOS</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">Pasaporte ARG</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">PA123456</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">10 sep 2026 (30 dias)</td>
    </tr>
    <tr>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">LOPEZ, MARIA</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">DNI</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">12345678</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">02 oct 2026 (52 dias)</td>
    </tr>
  </table>

  <div style="border-left:4px solid #b0552a;padding:6px 10px;margin:16px 0 8px 0;font-weight:bold;font-size:12px;letter-spacing:.06em;color:#b0552a;">CHECK INS</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;font-size:13px;">
    <tr style="background:#f2f4f7;color:#555;font-size:11px;text-transform:uppercase;">
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6aa;width:32%;">Pasajeros</th>
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6aa;width:28%;">Vuelo / Ruta</th>
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6aa;width:20%;">Fecha</th>
      <th style="text-align:left;padding:6px 8px;border:1px solid #e3e6aa;width:20%;">Ref</th>
    </tr>
    <tr>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;word-break:break-word;">GARCIA FERNANDEZ DE LOS SANTOS, JUAN CARLOS</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">AA908 &middot; EZE&rarr;MIA</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">10 sep, 21:00</td>
      <td style="padding:6px 8px;border:1px solid #e3e6aa;">KRBJJ</td>
    </tr>
  </table>

  <p style="margin:16px 0 0 0;color:#777;font-size:11px;">Email de prueba automatico de TradingDocs. Podes ignorarlo.</p>
</div>`;

const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    ...(accessToken ? { accessToken } : {}),
    template_params: { to_email: to, subject: 'TradingDocs · Test render HTML', message: html },
  }),
});

const body = await res.text();
console.log(`EmailJS respondio ${res.status}: ${body || '(sin body)'}`);
if (!res.ok) {
  console.error('Fallo el envio. Revisar keys/service/template.');
  process.exit(1);
}
console.log(`Enviado a ${to}. Abrir el email y verificar:`);
console.log('  1. Tipografia Arial (no la default del cliente).');
console.log('  2. Tabla con columnas alineadas; el nombre largo hace wrap en su columna.');
console.log('  3. El HTML no llega escapado (no se ven <td> como texto) ni envuelto en <pre>.');
