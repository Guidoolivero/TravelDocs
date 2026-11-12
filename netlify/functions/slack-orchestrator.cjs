// ============================================================
//  Netlify Function: slack-orchestrator
//  Endpoint de Slack Events. Verifica la firma, responde el
//  challenge de url_verification, deduplica reintentos y ackea
//  200 a Slack lo más rápido posible (<3s). El trabajo pesado
//  (route-agent + postToSlack) se difiere a la background
//  function slack-orchestrator-background, que Netlify invoca
//  de forma asíncrona (devuelve 202 al instante).
//
//  Por qué: Slack exige un 2xx en menos de 3s; si no, reintenta
//  hasta 3 veces (header x-slack-retry-num) y termina deshabilitando
//  el endpoint, duplicando los mensajes de routing en el hilo.
//
//  Variables de entorno necesarias en Netlify:
//  - SLACK_SIGNING_SECRET
//  - SLACK_INTERNAL_SECRET (protege la background function interna)
// ============================================================

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return reply(500, { error: 'SLACK_SIGNING_SECRET missing' });

  const headers = event.headers || {};

  // Reintento de Slack: ackeamos 200 sin hacer routing para no duplicar mensajes.
  if (getHeader(headers, 'x-slack-retry-num')) {
    return reply(200, { ok: true, skipped: 'retry' });
  }

  // Verificación de firma de Slack
  const timestamp = getHeader(headers, 'x-slack-request-timestamp');
  const signature = getHeader(headers, 'x-slack-signature');
  if (!timestamp || !signature) return reply(401, { error: 'Missing Slack signature' });

  // Ventana de frescura: rechaza timestamps viejos y demasiado futuros (±5 min).
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) {
    return reply(401, { error: 'Request timestamp out of range' });
  }

  // El HMAC se calcula sobre el cuerpo crudo exacto que firmó Slack.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `v0=${hmac}`;
  if (!safeEqual(expected, signature)) {
    return reply(401, { error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }

  // Challenge de verificación de URL
  if (payload.type === 'url_verification') {
    return reply(200, { challenge: payload.challenge });
  }

  // Solo procesamos eventos de mensaje
  if (payload.type !== 'event_callback' || payload.event?.type !== 'message') {
    return reply(200, { ok: true });
  }

  const msg = payload.event;

  // Ignorar mensajes de bots y subtypes
  if (msg.bot_id || msg.subtype || !msg.text || !msg.text.trim()) {
    return reply(200, { ok: true });
  }

  // Disparamos la background function (devuelve ~202 al instante) con el evento
  // ya validado y ackeamos 200 a Slack. El routing corre fuera del path crítico.
  try {
    const host = getHeader(headers, 'x-forwarded-host') || getHeader(headers, 'host');
    await fetch(`https://${host}/.netlify/functions/slack-orchestrator-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'x-slack-internal-secret': process.env.SLACK_INTERNAL_SECRET || ''
      },
      body: JSON.stringify({ event: msg }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    // Un fallo al disparar la background function no debe impedir el ack a Slack.
    console.error('background trigger failed:', err?.message || err);
  }

  return reply(200, { ok: true });
};

// Lectura de headers case-insensitive (Netlify/Slack no garantizan el casing).
function getHeader(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key];
  }
  return undefined;
}

// Comparación en tiempo constante que no explota (RangeError) con largos distintos.
function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
