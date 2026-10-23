const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();

export function matchItineraryPassengers(input, passengers) {
  const ids = [], pending = [];
  for (const p of input || []) {
    if (!p.apellido && !p.nombre) continue;
    const last = norm(p.apellido), first = norm(p.nombre);
    const matches = passengers.filter(x => last && first && norm(x.lastname) === last &&
      (norm(x.firstname) === first || (!first.includes(' ') && norm(x.firstname).split(' ')[0] === first)));
    if (matches.length === 1) ids.push(matches[0].id);
    else pending.push({ lastname: p.apellido || '', firstname: p.nombre || '' });
  }
  return { ids: [...new Set(ids)], pending };
}

export function mergePendingPassengers(current, incoming) {
  const entries = new Map();
  for (const p of [...current, ...incoming]) entries.set(`${norm(p.lastname)}|${norm(p.firstname)}`, p);
  return [...entries.values()];
}
