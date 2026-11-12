// ============================================================
//  Netlify Function: route-agent
//  Usa Gemini Decisions API (gemini-decision-1) para decidir
//  a qué agente mandar un mensaje (Cursor / Claude / Gemini).
//  Pensado para el flujo multi-agente en Slack.
// ============================================================

const { GoogleGenAI } = require('@google/genai');

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

  const { message } = body;
  if (!message || typeof message !== 'string') {
    return reply(400, { error: 'Falta el campo message (string).' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return reply(500, { error: 'GEMINI_API_KEY no está configurada en Netlify.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const result = await ai.decisions.create({
      model: 'gemini-decision-1',
      input: message,
      questions: {
        route: {
          type: 'choice',
          instructions: '¿A quién hay que mandar este pedido?',
          criteria: {
            cursor: 'Cambios de código, implementación, bugs, features, PRs, refactor',
            claude: 'Revisión, análisis, explicación, documentación, dudas, arquitectura',
            gemini: 'OCR, extracción de documentos, análisis de imágenes o PDFs',
            multiple: 'Necesita más de un agente en secuencia'
          }
        }
      }
    });

    const routeAnswer = result.answers?.route;

    return reply(200, {
      route: routeAnswer?.choice || 'claude',
      confidence: routeAnswer?.confidence ?? 0,
      probabilities: routeAnswer?.probabilities || {},
      type: routeAnswer?.type || 'choice'
    });

  } catch (err) {
    console.error('route-agent error:', err?.message || err);
    return reply(502, { error: 'Error al llamar a Gemini Decisions API', detail: err?.message || String(err) });
  }
};

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
