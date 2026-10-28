// Errores, tracing y metrics del browser. El DSN es una clave publica del
// proyecto tradingdocs-browser. Sin session replay: la pantalla muestra
// documentos. El bundle CDN tiene que incluir metrics
// (bundle.tracing.logs.metrics): en tracing.min, Sentry.metrics es no-op.
import { reportPageLoad, reportPageLog } from './sentry-metrics.mjs';

Sentry.init({
  dsn: "https://46da90f904841667bb503d7296aef48c@o4512249968852992.ingest.us.sentry.io/4512250062766081",
  environment: location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "development" : "production",
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: location.hostname === "localhost" || location.hostname === "127.0.0.1" ? 1.0 : 0.1,
  tracePropagationTargets: ["localhost", /^\//],
  // Outlook/Office inyecta esto en Chrome y rechaza una Promise con un string.
  // No es codigo nuestro (sin stack, landing, solo fetch de Ads).
  ignoreErrors: [/Object Not Found Matching Id:\d+, MethodName:update, ParamCount:\d+/],
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});

function emitLoadMetrics() {
  reportPageLoad(Sentry.metrics, performance, location.pathname);
  reportPageLog(Sentry.logger, location.pathname);
}

if (document.readyState === 'complete') {
  setTimeout(emitLoadMetrics, 0);
} else {
  window.addEventListener('load', () => setTimeout(emitLoadMetrics, 0));
}
