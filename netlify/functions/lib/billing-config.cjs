// Esta rama solo permite pruebas: una variable no puede habilitar ARCA produccion.
function assertBillingSandbox(env = process.env) {
  let project;
  try { project = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}').project_id; } catch {}
  if (env.BILLING_ENABLED !== 'true' || env.ARCA_ENVIRONMENT !== 'test' ||
      !project || project === 'tradingdocs-mt' || project !== env.BILLING_FIREBASE_PROJECT_ID ||
      (project.startsWith('demo-') && !env.FIRESTORE_EMULATOR_HOST)) {
    throw Object.assign(new Error('Facturador deshabilitado: requiere ARCA test y Firebase de pruebas aislado.'), { status: 503 });
  }
  return project;
}
function billingEnabled() {
  try { assertBillingSandbox(); return true; } catch { return false; }
}
module.exports = { assertBillingSandbox, billingEnabled };
