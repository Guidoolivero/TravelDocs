// ============================================================
//  Netlify Function: slack-orchestrator (sincrónica, de cara a Slack)
//  Verifica la firma de Slack, responde el ack 200 en <3s y difiere
//  el routing a slack-orchestrator-background (invocación interna).
//
//  Por qué: route-agent llama a Gemini y puede tardar ~10s. Slack exige
//  el 200 en menos de 3s o reintenta hasta 3 veces y deshabilita el
//  endpoint. Hacer el trabajo acá generaba mensajes duplicados en el hilo.
//
//  Variables de entorno necesarias en Netlify:
//  - SLACK_SIGNING_SECRET
//  - ROUTE_AGENT_SECRET   (protege la background function interna)
//  - SITE_URL (ej: https://tu-site.netlify.app)
// ============================================================

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return reply(500, { error: 'SLACK_SIGNING_SECRET missing' });

  // Netlify puede entregar el body en base64 según el entorno.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const headers = event.headers || {};
  const timestamp = headers['x-slack-request-timestamp'] || headers['X-Slack-Request-Timestamp'];
  const signature = headers['x-slack-signature'] || headers['X-Slack-Signature'];
  if (!timestamp || !signature) return reply(401, { error: 'Missing Slack signature' });

  // Rechaza timestamps viejos o del futuro (anti-replay), ventana de 5 min.
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 60 * 5) {
    return reply(401, { error: 'Request timestamp out of range' });
  }

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

  // Challenge de verificación de URL (responde sincrónico).
  if (payload.type === 'url_verification') {
    return reply(200, { challenge: payload.challenge });
  }

  // Si Slack reintenta (no recibió el 200 a tiempo), ackeamos y cortamos
  // para no publicar routing duplicado.
  if (headers['x-slack-retry-num'] || headers['X-Slack-Retry-Num']) {
    return reply(200, { ok: true, skipped: 'retry' });
  }

  // Solo procesamos eventos de mensaje.
  if (payload.type !== 'event_callback' || payload.event?.type !== 'message') {
    return reply(200, { ok: true });
  }

  const msg = payload.event;

  // Ignorar mensajes de bots y subtypes.
  if (msg.bot_id || msg.subtype || !msg.text || !msg.text.trim()) {
    return reply(200, { ok: true });
  }

  // Diferimos el trabajo: disparamos la background function y devolvemos
  // el 200 de inmediato. La invocación devuelve 202 enseguida; la
  // esperamos solo para garantizar que el request salió antes de que el
  // runtime congele la función.
  const siteUrl = process.env.SITE_URL || 'https://traveldocs.netlify.app';
  const secret = process.env.ROUTE_AGENT_SECRET;
  if (!secret) return reply(500, { error: 'ROUTE_AGENT_SECRET missing' });

  try {
    await fetch(`${siteUrl}/.netlify/functions/slack-orchestrator-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${secret}`
      },
      body: JSON.stringify({
        channel: msg.channel,
        thread_ts: msg.ts,
        text: msg.text
      }),
      signal: AbortSignal.timeout(2500)
    });
  } catch (err) {
    // No devolvemos error a Slack (gatillaría reintentos y duplicados).
    console.error('background dispatch failed:', err.message);
  }

  return reply(200, { ok: true });
};

// Comparación en tiempo constante que no lanza RangeError si los largos
// difieren (una firma malformada debe caer en 401, no en 500).
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
