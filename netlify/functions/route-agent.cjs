// ============================================================
//  Netlify Function: route-agent
//  Usa Gemini Decisions API (gemini-decision-1) para decidir
//  a qué agente mandar un mensaje (Cursor / Claude / Gemini).
//  Pensado para el flujo multi-agente en Slack.
//  Sin verifyAuth: Slack y MCP lo llaman sin token de TravelDocs.
// ============================================================

const criteria = {
  cursor: 'Cambios de código, implementación, bugs, features, PRs, refactor',
  claude: 'Revisión, análisis, explicación, documentación, dudas, arquitectura',
  gemini: 'OCR, extracción de documentos, análisis de imágenes o PDFs',
  multiple: 'Necesita más de un agente en secuencia'
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return reply(400, { error: 'Body inválido (JSON requerido).' });
  }

  const message = body?.message;
  if (typeof message !== 'string' || !message.trim()) {
    return reply(400, { error: 'Falta el campo message (string).' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return reply(500, { error: 'GEMINI_API_KEY no está configurada en Netlify.' });
  }

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: 'gemini-decision-1',
        input: message,
        questions: {
          route: {
            type: 'choice',
            instructions: '¿A quién hay que mandar este pedido?',
            criteria
          }
        }
      })
    });

    if (!response.ok) throw new Error(`Gemini Decisions HTTP ${response.status}`);
    const result = await response.json();
    const routeAnswer = result.answers?.route;
    if (routeAnswer?.type !== 'choice' || !Object.hasOwn(criteria, routeAnswer.choice)
      || !Number.isFinite(routeAnswer.confidence) || routeAnswer.confidence < 0 || routeAnswer.confidence > 1) {
      throw new Error('Respuesta invalida de Gemini Decisions');
    }

    return reply(200, {
      route: routeAnswer.choice,
      confidence: routeAnswer.confidence,
      probabilities: routeAnswer.probabilities || {},
      type: routeAnswer.type
    });

  } catch (err) {
    console.error('route-agent error:', err?.message || err);
    return reply(502, { error: 'Error al llamar a Gemini Decisions API' });
  }
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
