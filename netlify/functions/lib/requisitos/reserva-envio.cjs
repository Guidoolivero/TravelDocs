// Reserva compartida del mail de requisitos entre checkin-reqs (al crear) y el cron
// (a 30 dias). Antes de enviar, una transaccion vuelve a mirar la reserva vigente:
// si ya no corresponde o el otro camino lo esta enviando, no se manda. La reserva
// vence a los 2 min por si la funcion muere a mitad del envio.
const RESERVA_MS = 120000;

async function reservarEnvioRequisitos(db, ref, debeEnviar, now = Date.now()) {
  return db.runTransaction(async tx => {
    const actual = (await tx.get(ref)).data() || {};
    if (!debeEnviar(actual) || now - (actual.reqsEnviando || 0) < RESERVA_MS) return false;
    tx.update(ref, { reqsEnviando: now });
    return true;
  });
}

module.exports = { reservarEnvioRequisitos };
