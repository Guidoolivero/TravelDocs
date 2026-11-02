function assertBillingEnvironment(env = process.env) {
  // Netlify no inyecta CONTEXT en Functions: el bundle fija el contexto al compilar.
  const context = typeof BILLING_BUILD_CONTEXT === 'string' ? BILLING_BUILD_CONTEXT : env.CONTEXT;
  let project;
  try { project = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}').project_id; } catch {}
  const matchingProject = project && project === env.BILLING_FIREBASE_PROJECT_ID;
  if (env.BILLING_ENABLED === 'true' && matchingProject) {
    if (env.ARCA_ENVIRONMENT === 'test' && project !== 'tradingdocs-mt' &&
        (!project.startsWith('demo-') || env.FIRESTORE_EMULATOR_HOST)) return 'test';
    const point = Number(env.ARCA_SALES_POINT);
    if (env.ARCA_ENVIRONMENT === 'production' && project === 'tradingdocs-mt' &&
        context === 'production' && !env.FIRESTORE_EMULATOR_HOST &&
        /^\d{11}$/.test(env.ARCA_TAX_ID || '') && Number.isInteger(point) && point >= 1 && point <= 99998 &&
        env.BILLING_PRODUCTION_CONFIRMATION === `${env.ARCA_TAX_ID}:${point}`) return 'production';
  }
  throw Object.assign(new Error('Facturador deshabilitado: revisar el ambiente, proyecto y habilitacion de facturacion.'), { status: 503 });
}
function billingEnabled() {
  try { assertBillingEnvironment(); return true; } catch { return false; }
}
module.exports = { assertBillingEnvironment, billingEnabled };
