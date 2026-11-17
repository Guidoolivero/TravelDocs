// Expone un handler con forma Lambda ({ httpMethod, headers, body } -> { statusCode, headers, body })
// con la API v2 de Netlify (Request -> Response). Netlify deja de aceptar el modo Lambda en julio 2027.
module.exports = handler => async (req, context) => {
  const url = new URL(req.url);
  const res = await handler({
    httpMethod: req.method,
    path: url.pathname,
    rawUrl: req.url,
    headers: Object.fromEntries(req.headers),
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: (await req.text()) || null,
    isBase64Encoded: false,
  }, context);
  // Background y cron no devuelven nada. 204/304 no admiten body (reply(204, {}) arma '{}').
  const status = res?.statusCode || 204;
  return new Response(status === 204 || status === 304 ? null : res.body || null, { status, headers: res?.headers });
};
