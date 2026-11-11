import { estado } from '../compartido/estado.mjs';
import { collectDocumentAlertItems } from '../compartido/utils.js';

export function daysUntilBirthday(dob) {
  if (!dob) return null;
  const d = new Date(dob + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < todayStart) next.setFullYear(now.getFullYear() + 1);
  return Math.floor((next - todayStart) / 86400000);
}

export function isDismissed(key) { return !!localStorage.getItem(key); }

export function setDismissed(key) { localStorage.setItem(key, '1'); }

export function birthdayBadge(days) {
  const label = days === 0 ? '¡Hoy!' : days === 1 ? 'Mañana' : `En ${days}d`;
  return `<span class="badge badge-purple">${label}</span>`;
}

export function getAlertItems() {
  const items = collectDocumentAlertItems(estado.passengers, isDismissed);
  estado.passengers.forEach(p => {
    const name = `${p.lastname}, ${p.firstname}`;
    const email = p.email || '';
    // Cumpleaños próximos (30 días)
    if (p.dob) {
      const days = daysUntilBirthday(p.dob);
      if (days !== null && days >= 0 && days <= 30) {
        const dismissKey = `dismissed_${p.id}_birthday_${new Date().getFullYear()}`;
        if (!isDismissed(dismissKey)) {
          items.push({ pid: p.id, name, email, docType: 'Cumpleaños', docNum: '—', expDate: p.dob, days, urgency: days <= 7 ? 2 : 3, isBirthday: true, dismissKey });
        }
      }
    }
  });
  return items.sort((a,b) => a.days - b.days);
}
