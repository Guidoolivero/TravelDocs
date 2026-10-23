function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function matchesPassenger(p, query) {
  const text = normalize([p.lastname, p.firstname, p.dni?.num, p.parg?.num, p.pext?.num, p.notes].filter(Boolean).join(' '));
  return normalize(query).trim().split(/\s+/).every(word => text.includes(word));
}
