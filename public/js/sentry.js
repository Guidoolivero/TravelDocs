// Errores y tracing del browser. El DSN es una clave publica del proyecto
// tradingdocs-browser. Sin session replay: la pantalla muestra documentos.
Sentry.init({
  dsn: "https://46da90f904841667bb503d7296aef48c@o4512249968852992.ingest.us.sentry.io/4512250062766081",
  environment: location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "development" : "production",
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: location.hostname === "localhost" || location.hostname === "127.0.0.1" ? 1.0 : 0.1,
  tracePropagationTargets: ["localhost", /^\//],
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});
