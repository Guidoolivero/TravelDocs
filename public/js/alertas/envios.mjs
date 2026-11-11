import { estado } from '../compartido/estado.mjs';
import { updatePassenger, isNotified, markNotified, markReservationLegsNotified } from '../db.js';
import { collectEmailAlertCandidates } from '../compartido/utils.js';
import { checkinAlertDue, isBirthdayToday, anioART, buildAlertEmail as buildAlertEmailHtml } from './alert-core.mjs';
import { storedPiernas, resPiernas, resPaxSurnames } from '../reservas/pantalla.mjs';


// ── Alerta por email unificado (fallback cliente) ────────────
// El envío principal es la scheduled function send-alerts.cjs (Netlify,
// 9:00 AM ART, independiente de sesión). Acá cubrimos "la app se abre antes
// de la corrida o el server falló": al llegar los dos snapshots (pasajeros
// y reservas) se chequea si falta enviar algo y sale en el momento.
//
// UN solo email por destinatario con secciones Vencimientos | Check Ins |
// Cumpleaños (asunto dinámico). Los check-ins con alertEmail propio van en
// un email individual SOLO a ese email (no aparecen en el unificado de la
// agencia).
//
// Dedup compartido con el server (el que llega primero marca): colección
// notifications/{key} para vencimientos, birthdayNotifiedYear para
// cumpleaños, piernas[].notified para check-ins.
async function checkAndSendUnifiedAlerts() {
  if (!estado._paxLoaded || !estado._resLoaded) return;
  const { emailjsPublicKey, emailjsServiceId, emailjsTemplateId, email } = estado.alertConfig;
  if (!emailjsPublicKey || !emailjsServiceId || !emailjsTemplateId) {
    console.warn('[Alertas] Config EmailJS incompleta en agencies/{id}.alerts, se omite el chequeo.');
    return;
  }
  if (estado._alertsCheckedThisSession) return;
  estado._alertsCheckedThisSession = true;

  const now = Date.now();

  // Vencimientos: dentro de la ventana (180 días, asistencias 30) y sin
  // marca en notifications. Clave passengerId+docType+expDate: cada
  // vencimiento se notifica UNA sola vez; si renuevan, la clave cambia.
  let toNotify = [];
  try {
    const candidates = collectEmailAlertCandidates(estado.passengers, now);
    const already = await Promise.all(candidates.map(e => isNotified(e.key)));
    toNotify = candidates.filter((_, i) => !already[i]).sort((a, b) => a.days - b.days);
  } catch (err) {
    console.warn('[Alertas] No se pudo leer notifications:', err?.message || err);
  }

  // Cumpleaños de hoy sin marcar el año (año calendario argentino).
  const year = anioART(now);
  const bdCandidates = estado.passengers
    .filter(p => isBirthdayToday(p, now) && (!p.birthdayNotifiedYear || p.birthdayNotifiedYear !== year))
    .map(p => ({ p, name: `${p.lastname}, ${p.firstname}`, dob: p.dob }));

  // Check-ins due según el adelanto de cada reserva (24/48/72hs = días de
  // anticipación), sin check-in hecho y sin notificar. Agrupados por
  // destinatario: alertEmail de la reserva o inbox de la agencia.
  const grupos = new Map(); // email destino -> [{ r, idx, vuelo, route, fecha, reservaVuelo }]
  for (const r of estado.reservations) {
    const to = (r.alertEmail || '').trim() || email;
    if (!to) continue;
    const horas = [24, 48, 72].includes(Number(r.alertHorasAntes)) ? Number(r.alertHorasAntes) : 24;
    for (const p of resPiernas(r)) {
      if (p.done || p.notified) continue;
      if (!checkinAlertDue(p.fecha, horas, now)) continue;
      if (!grupos.has(to)) grupos.set(to, []);
      grupos.get(to).push({ r, idx: p.idx, vuelo: p.vuelo, route: p.route, fecha: p.fecha, reservaVuelo: p.reservaVuelo });
    }
  }

  const checkinsAgencia = email ? (grupos.get(email) || []) : [];
  const destinos = new Set(grupos.keys());
  const individuales = [];
  for (const to of destinos) {
    if (email && to === email) continue; // ya van en el unificado
    individuales.push({ to, items: grupos.get(to) || [] });
  }

  if (!toNotify.length && !bdCandidates.length && !checkinsAgencia.length && !individuales.length) {
    console.log('[Alertas] Nada pendiente de enviar (vencimientos: 0, cumpleaños: 0, check-ins: 0).');
    return;
  }


  // Marca piernas[].notified agrupando por reserva (un solo update por doc:
  // marcar tramos del mismo doc en updates separados pierde marcas).
  const marcarPiernas = async items => {
    const porReserva = new Map();
    items.forEach(x => {
      if (!porReserva.has(x.r.id)) porReserva.set(x.r.id, { r: x.r, idxs: [] });
      porReserva.get(x.r.id).idxs.push(x.idx);
    });
    await Promise.all([...porReserva.values()].map(({ r, idxs }) => {
      const piernas = storedPiernas(r);
      return markReservationLegsNotified(r.id, idxs.map(i => piernas[i]).filter(Boolean));
    }));
  };

  const itemCheckin = x => ({ pax: resPaxSurnames(x.r), paxCount: (x.r.pasajeros || []).length, vuelo: x.vuelo, ruta: x.route, fecha: x.fecha, ref: x.reservaVuelo });

  try {
    const ejs = await import('https://cdn.jsdelivr.net/npm/@emailjs/browser@4/+esm');
    const ejsLib = ejs.default || ejs;
    ejsLib.init({ publicKey: emailjsPublicKey });
    const enviar = (to, subject, html) => ejsLib.send(emailjsServiceId, emailjsTemplateId, { to_email: to, subject, message: html });

    // 1) Individuales PRIMERO: si uno falla, esa pierna no se marca y
    //    reintenta (próxima corrida del server / próximo snapshot). Gap entre
    //    envíos: EmailJS limita a 1 request/segundo.
    for (const { to, items } of individuales) {
      const { subject, html } = buildAlertEmailHtml({
        appName: estado.agencyName || estado.appName,
        checkins: items.map(itemCheckin),
      });
      try {
        await enviar(to, subject, html);
        await new Promise(r => setTimeout(r, 1100));
        if (items.length) await marcarPiernas(items);
        console.log(`[Alertas] Email individual enviado OK a ${to} (${items.length} check-in).`);
      } catch (err) {
        console.warn(`[Alertas] Falló el email individual a ${to}:`, err?.message || err);
      }
    }

    // 2) Unificado al inbox de la agencia (si hay algo para ella).
    if (email && (toNotify.length || checkinsAgencia.length || bdCandidates.length)) {
      const { subject, html } = buildAlertEmailHtml({
        appName: estado.agencyName || estado.appName,
        vencimientos: toNotify,
        checkins: checkinsAgencia.map(itemCheckin),
        cumpleanos: bdCandidates,
      });
      await enviar(email, subject, html);
      console.log('[Alertas] Email unificado enviado OK:', subject);

      // Marcas solo tras envío exitoso.
      await Promise.all([
        ...toNotify.map(e => markNotified(e.key)),
        ...bdCandidates.map(e => updatePassenger(e.p.id, { birthdayNotifiedYear: year })),
      ]);
      if (checkinsAgencia.length) await marcarPiernas(checkinsAgencia);
    }
  } catch (err) {
    estado._alertsCheckedThisSession = false; // reintenta en el próximo snapshot
    console.warn('[Alertas] No se pudo enviar el email unificado:', err?.message || err);
  }
}
export { checkAndSendUnifiedAlerts };
