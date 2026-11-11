const { FieldValue } = require('firebase-admin/firestore');

async function auditBilling(db, auth, action, invoice, stage = 'result') {
  try {
    await db.collection('auditLogs').add({
      action, performedBy: auth.uid, performedByEmail: auth.email || '',
      agencyId: invoice.agencyId || null, targetUid: null,
      details: { invoiceId: invoice.id, period: invoice.period || null,
        environment: invoice.environment || 'test', status: invoice.status, stage },
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch {
    // Un fallo auxiliar no debe provocar que el usuario repita una emision.
    console.error('billing-audit: no se pudo registrar la operacion.');
  }
}
module.exports = { auditBilling };
