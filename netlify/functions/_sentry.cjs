// Init de Sentry para las Netlify Functions.
// Se carga al requerir el modulo, y wrapHandler asegura el flush
// antes de que el runtime congele el proceso.
// Sin bodies, headers de auth ni prompts: estas functions reciben
// DNI, pasaportes y texto de documentos.

const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN || "https://42b597a96ad65eeae08000688d3427d1@o4512249968852992.ingest.us.sentry.io/4512250062766080",
  environment: process.env.CONTEXT || process.env.SENTRY_ENVIRONMENT || "development",
  release: process.env.COMMIT_REF || process.env.SENTRY_RELEASE,
  tracesSampleRate: 1.0,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { deny: ["authorization", "cookie"] },
    httpBodies: [],
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },
});

function wrapHandler(handler) {
  return async function sentryWrapped(event, context) {
    return Sentry.startSpan(
      { name: (event && (event.path || event.rawUrl)) || "netlify.handler", op: "function.netlify" },
      async () => {
        try {
          return await handler(event, context);
        } catch (err) {
          Sentry.captureException(err);
          await Sentry.flush(2000);
          throw err;
        }
      }
    );
  };
}

module.exports = { wrapHandler };
