// ============================================================
//  Netlify Function: slack-orchestrator
//  Recibe eventos de Slack (message) y orquesta el routing
//  con route-agent + agentes (Cursor / Claude / Gemini).
//
//  Flujo:
//  1. Slack manda message event
//  2. Llama a route-agent con ROUTE_AGENT_SECRET
//  3. Según la respuesta, notifica o dispara el agente principal
//  4. Los otros dos revisan; Claude tiene la última palabra
//
//  Variables de entorno necesarias en Netlify:
//  - SLACK_SIGNING_SECRET
//  - SLACK_BOT_TOKEN
//  - ROUTE_AGENT_SECRET
//  - SITE_URL (ej: https://tu-site.netlify.app)
// ============================================================

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  // Verificación de firma de Slack
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return reply(500, { error: 'SLACK_SIGNING_SECRET missing' });

  const timestamp = event.headers['x-slack-request-timestamp'];
  const signature = event.headers['x-slack-signature'];
  if (!timestamp || !signature) return reply(401, { error: 'Missing Slack signature' });

  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (timestamp < fiveMinutesAgo) return reply(401, { error: 'Request too old' });

  const baseString = `v0:${timestamp}:${event.body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `v0=${hmac}`;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return reply(401, { error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
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

  // Llamar al route-agent
  const siteUrl = process.env.SITE_URL || 'https://traveldocs.netlify.app';
  const secret = process.env.ROUTE_AGENT_SECRET;
  if (!secret) return reply(500, { error: 'ROUTE_AGENT_SECRET missing' });

  let routeResult;
  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/route-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`
      },
      body: JSON.stringify({ message: msg.text })
    });
    if (!res.ok) throw new Error(`route-agent HTTP ${res.status}`);
    routeResult = await res.json();
  } catch (err) {
    console.error('route-agent call failed:', err.message);
    await postToSlack(msg.channel, msg.ts, `⚠️ Error al hacer routing: ${err.message}`);
    return reply(200, { ok: true });
  }

  const route = routeResult.route || 'claude';
  const confidence = routeResult.confidence ?? 0;

  // Mensaje inicial en el hilo
  const primary = route === 'cursor' ? 'Cursor' : route === 'gemini' ? 'Gemini' : 'Claude';
  await postToSlack(
    msg.channel,
    msg.ts,
    `🤖 Routing: *${primary}* (confianza ${(confidence * 100).toFixed(0)}%)\nLos otros agentes van a revisar. Claude tiene la última palabra.`
  );

  // Aquí iría la lógica para notificar a cada agente via sus MCPs o webhooks.
  // Por ahora solo registramos y avisamos en Slack.
  // TODO: integrar llamadas a Cursor MCP, Claude, Gemini según el route.

  return reply(200, { ok: true, route });
};

async function postToSlack(channel, thread_ts, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ channel, thread_ts, text })
  });
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
