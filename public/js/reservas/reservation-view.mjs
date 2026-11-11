export function passengerDetailFlags(from) {
  if (from === 'checkin') return { includeSSR: false, includeActions: false };
  return { includeSSR: true, includeActions: true };
}

export function reservationViewPassengers(r, passengers) {
  const ids = (r && r.pasajeros) || [];
  const list = passengers || [];
  return ids.map(id => {
    const p = list.find(x => x.id === id);
    if (!p) return null;
    return {
      id: p.id,
      lastname: p.lastname || '',
      firstname: p.firstname || '',
      dob: p.dob || '',
    };
  }).filter(Boolean);
}

// Buscador de Check ins: nombre o apellido de pasajeros vinculados y sin vincular.
export function reservationMatchesSearch(r, passengers, query) {
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = norm(query);
  if (!q) return true;
  return [...reservationViewPassengers(r, passengers), ...(r.pendingPassengers || [])]
    .some(p => norm(`${p.lastname} ${p.firstname}`).includes(q));
}

export function uniqueAirlineLocators(piernas) {
  const seen = new Set();
  const out = [];
  for (const p of piernas || []) {
    const compania = String(p.compania || '').trim().toUpperCase();
    const reservaVuelo = String(p.reservaVuelo || '').trim().toUpperCase();
    if (!compania && !reservaVuelo) continue;
    const key = `${compania}::${reservaVuelo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ compania, reservaVuelo });
  }
  return out;
}

export function reservationViewLayout(piernas) {
  const locators = uniqueAirlineLocators(piernas);
  const many = locators.length > 1;
  return { locators, showLocatorOnLegs: many, showAirlineOnLegs: many };
}
