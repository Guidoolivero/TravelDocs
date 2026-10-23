import { hoyART, diasEntre } from './alert-core.mjs';

export function validateFormReminders(forms) {
  for (const f of forms) {
    if (!f.id || typeof f.id !== 'string') return 'El formulario no tiene identificador. Quitalo y volvé a agregarlo.';
    if (!f.title?.trim()) return 'Completá el nombre del formulario.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ||
        !Number.isFinite(Date.parse(f.date)) || new Date(f.date).toISOString().slice(0, 10) !== f.date) {
      return 'Completá una fecha de ingreso válida para cada formulario.';
    }
    if (!Number.isInteger(f.daysBefore) || f.daysBefore < 0 || f.daysBefore > 365) {
      return 'La anticipación del formulario debe ser de 0 a 365 días enteros.';
    }
  }
  return '';
}

export function dueFormReminders(reservations, now = Date.now()) {
  const today = hoyART(now);
  return reservations.flatMap(r => (r.formReminders || []).flatMap(f => {
    if (f.completed || validateFormReminders([f])) return [];
    const days = diasEntre(today, f.date);
    return days >= 0 && days <= f.daysBefore
      ? [{ ...f, reservationId: r.id, key: `form_${encodeURIComponent(r.id)}_${encodeURIComponent(f.id)}_${f.date}_${f.daysBefore}` }]
      : [];
  })).sort((a, b) => a.date.localeCompare(b.date));
}
