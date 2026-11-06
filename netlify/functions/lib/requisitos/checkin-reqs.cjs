// Mail de requisitos al crear un check-in. Misma info que el aviso de
// check-in (vuelo, ruta, fecha, reserva) más visa y sanidad de la matriz.
// Si el viaje ya está a 30 días o menos, esa marca también cubre el aviso
// de los 30 días. Si falta más, el cron manda el mismo mail al entrar.

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { verifyAuth } = require('../../_auth.cjs');
const { debeEnviarRequisitos, emailAviso, buildRequisitosEmail, marcasTrasEnvioRequisitos } = require('../../../../lib/requisitos/requisitos-checkin.mjs');

const EMAILJS_SEND_URL = 'https://api.emailjs.com/api/v1.0/email/send';

function reply(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function sendEmail({ publicKey, privateKey, serviceId, templateId, to, subject, html }) {
  const res = await fetch(EMAILJS_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      ...(privateKey ? { accessToken: privateKey } : {}),
      template_params: { to_email: to, subject, message: html },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`EmailJS ${res.status}: ${body.slice(0, 200)}`);
  }
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'POST' });

  const auth = await verifyAuth(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });

  let reservationId = '';
  try {
    reservationId = JSON.parse(event.body || '{}').reservationId || '';
  } catch {
    return reply(400, { error: 'Body inválido.' });
  }
  if (!reservationId) return reply(400, { error: 'Falta el check-in.' });

  const db = admin.firestore();
  const agenciaRef = db.collection('agencies').doc(auth.agencyId);
  const ref = agenciaRef.collection('reservations').doc(reservationId);
  const snap = await ref.get();
  if (!snap.exists) return reply(404, { error: 'Check-in no encontrado.' });

  const reserva = { id: snap.id, ...snap.data() };
  if (reserva.reqsNotified) return reply(200, { sent: false, reason: 'ya-avisado' });

  const ids = Array.isArray(reserva.pasajeros) ? reserva.pasajeros : [];
  const docs = await Promise.all(ids.map(id => agenciaRef.collection('passengers').doc(id).get()));
  const pasajeros = docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));
  if (!debeEnviarRequisitos(reserva, { alCrear: true, pasajeros })) {
    return reply(200, { sent: false, reason: 'cabotaje' });
  }

  const agency = (await agenciaRef.get()).data() || {};
  const alerts = agency.alerts || {};
  const to = emailAviso(reserva.alertEmail, alerts.email);
  if (!to || !alerts.emailjsPublicKey || !alerts.emailjsServiceId || !alerts.emailjsTemplateId) {
    return reply(200, { sent: false, reason: 'sin-email' });
  }
  const { subject, html } = buildRequisitosEmail({
    appName: agency.name || agency.branding?.appName || 'TravelDocs',
    reserva,
    pasajeros,
    alCrear: true,
  });

  try {
    await sendEmail({
      publicKey: alerts.emailjsPublicKey,
      privateKey: (process.env.EMAILJS_PRIVATE_KEY || '').trim(),
      serviceId: alerts.emailjsServiceId,
      templateId: alerts.emailjsTemplateId,
      to, subject, html,
    });
  } catch (err) {
    console.error('checkin-reqs:', err?.message || err);
    return reply(502, { error: 'No se pudo enviar el mail.' });
  }

  await ref.update({
    ...marcasTrasEnvioRequisitos(reserva, { alCrear: true }),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return reply(200, { sent: true });
};

exports.handler = require('../../_sentry.cjs').wrapHandler(exports.handler);
