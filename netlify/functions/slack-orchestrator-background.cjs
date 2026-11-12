// ============================================================
//  Netlify Background Function: slack-orchestrator-background
//  Hace el trabajo de routing diferido para slack-orchestrator.
//  Netlify corre las *-background functions de forma asíncrona
//  (responde 202 al invocador, límite de 15 min), así que el ack de
//  3s de Slack ya se devolvió antes de que esto se ejecute.
//
//  Protección: Authorization: Bearer <ROUTE_AGENT_SECRET>. Es una
//  invocación interna desde slack-orchestrator, no un endpoint público.
//
//  Variables de entorno necesarias en Netlify:
//  - ROUTE_AGENT_SECRET
//  - SLACK_BOT_TOKEN
//  - SITE_URL
// ============================================================

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  const secret = process.env.ROUTE_AGENT_SECRET;
  if (!secret) return reply(500, { error: 'ROUTE_AGENT_SECRET missing' });

  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization || '';
  if (authHeader !== `Bearer ${secret}`) {
    return reply(401, { error: 'Unauthorized' });
  }

  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    body = JSON.parse(raw || '{}');
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }

  const { channel, thread_ts, text } = body;
  if (!channel || !thread_ts || typeof text !== 'string' || !text.trim()) {
    return reply(400, { error: 'Faltan channel, thread_ts o text' });
  }

  const siteUrl = process.env.SITE_URL || 'https://traveldocs.netlify.app';

  let routeResult;
  try {
    const res = await fetch(`${siteUrl}/.netlify/functions/route-agent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${secret}`
      },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`route-agent HTTP ${res.status}`);
    routeResult = await res.json();
  } catch (err) {
    console.error('route-agent call failed:', err.message);
    await postToSlack(channel, thread_ts, `⚠️ Error al hacer routing: ${err.message}`);
    return reply(200, { ok: false });
  }

  const route = routeResult.route || 'claude';
  const confidence = routeResult.confidence ?? 0;
  const pct = (Math.max(0, Math.min(1, Number(confidence) || 0)) * 100).toFixed(0);

  const text2 = route === 'multiple'
    ? `🤖 Routing: *varios agentes* en secuencia (confianza ${pct}%)\nSe coordinan entre sí. Claude tiene la última palabra.`
    : `🤖 Routing: *${agentLabel(route)}* (confianza ${pct}%)\nLos otros agentes van a revisar. Claude tiene la última palabra.`;

  await postToSlack(channel, thread_ts, text2);

  // TODO: integrar llamadas a Cursor MCP, Claude, Gemini según el route.

  return reply(200, { ok: true, route });
};

function agentLabel(route) {
  if (route === 'cursor') return 'Cursor';
  if (route === 'gemini') return 'Gemini';
  return 'Claude';
}

async function postToSlack(channel, thread_ts, text) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN missing; no se puede postear en Slack');
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
      console.error(`Slack postMessage HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    if (!data.ok) {
      console.error(`Slack postMessage error: ${data.error}`);
    }
  } catch (err) {
    console.error('postToSlack failed:', err.message);
  }
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
