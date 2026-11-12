// ============================================================
//  Netlify Background Function: slack-orchestrator-background
//  Hace el trabajo pesado del routing fuera del path crítico del
//  ack a Slack: llama a route-agent (que consulta Gemini, ~10s) y
//  postea el resultado en el hilo. El sufijo -background hace que
//  Netlify la invoque de forma asíncrona y devuelva 202 al instante,
//  así slack-orchestrator puede ackear a Slack en <3s.
//
//  Protección: solo invocable internamente desde slack-orchestrator
//  mediante el header x-slack-internal-secret (SLACK_INTERNAL_SECRET),
//  para que no se pueda disparar desde afuera.
//
//  Variables de entorno necesarias en Netlify:
//  - SLACK_INTERNAL_SECRET
//  - SLACK_BOT_TOKEN
//  - ROUTE_AGENT_SECRET
//  - SITE_URL (ej: https://tu-site.netlify.app)
// ============================================================

const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  // Solo invocable internamente desde slack-orchestrator.
  const internalSecret = process.env.SLACK_INTERNAL_SECRET;
  if (!internalSecret) return reply(500, { error: 'SLACK_INTERNAL_SECRET missing' });
  const provided = getHeader(event.headers, 'x-slack-internal-secret');
  if (!provided || !safeEqual(provided, internalSecret)) {
    return reply(401, { error: 'Unauthorized' });
  }

  let msg;
  try {
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    msg = JSON.parse(rawBody || '{}').event;
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }
  if (!msg?.channel || !msg?.text) return reply(400, { error: 'Missing event' });

  // Llamar al route-agent
  const siteUrl = process.env.SITE_URL || 'https://traveldocs.netlify.app';
  const secret = process.env.ROUTE_AGENT_SECRET;
  if (!secret) return reply(500, { error: 'ROUTE_AGENT_SECRET missing' });

  let routeResult;
  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/route-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${secret}`
      },
      body: JSON.stringify({ message: msg.text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`route-agent HTTP ${res.status}`);
    routeResult = await res.json();
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout al llamar a route-agent' : (err?.message || String(err));
    console.error('route-agent call failed:', reason);
    await postToSlack(msg.channel, msg.ts, `⚠️ Error al hacer routing: ${reason}`);
    return reply(200, { ok: true });
  }

  const route = routeResult.route || 'claude';
  const confidence = routeResult.confidence ?? 0;
  const pct = (confidence * 100).toFixed(0);

  // route-agent expresa el caso multi-agente como route === 'multiple'.
  const text = route === 'multiple'
    ? `🤖 Routing: *multi-agente* (confianza ${pct}%)\nEste pedido necesita varios agentes en secuencia (Cursor, Gemini, Claude). Claude tiene la última palabra.`
    : `🤖 Routing: *${agentName(route)}* (confianza ${pct}%)\nLos otros agentes van a revisar. Claude tiene la última palabra.`;

  await postToSlack(msg.channel, msg.ts, text);

  // Aquí iría la lógica para notificar a cada agente via sus MCPs o webhooks.
  // TODO: integrar llamadas a Cursor MCP, Claude, Gemini según el route.

  return reply(200, { ok: true, route });
};

function agentName(route) {
  return route === 'cursor' ? 'Cursor' : route === 'gemini' ? 'Gemini' : 'Claude';
}

async function postToSlack(channel, thread_ts, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('postToSlack omitido: SLACK_BOT_TOKEN missing');
    return;
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ channel, thread_ts, text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      console.error(`postToSlack HTTP ${res.status}`);
      return;
    }
    // Slack responde 200 con { ok: false, error } ante fallos lógicos.
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error(`postToSlack Slack error: ${data.error || 'desconocido'}`);
    }
  } catch (err) {
    console.error('postToSlack failed:', err?.message || err);
  }
}

// Lectura de headers case-insensitive (Netlify no garantiza el casing).
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
