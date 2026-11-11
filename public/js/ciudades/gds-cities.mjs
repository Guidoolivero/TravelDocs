const OLD_SEEDS = new Set(['amadeus', 'sabre']);

function normGds(gds) {
  return gds === 'sabre' ? 'sabre' : 'amadeus';
}

export function normalizeCity(raw) {
  const src = raw || {};
  return {
    id: String(src.id || ''),
    title: String(src.title || '').trim(),
    gds: normGds(src.gds),
    code: String(src.code || '').trim(),
    saved: src.saved === true,
    editing: src.editing === true,
  };
}

export function fromStorage(list) {
  const items = Array.isArray(list) ? list : [];
  return items
    .map(c => normalizeCity({ ...c, saved: true }))
    .filter(c => c.id)
    .filter(c => !(OLD_SEEDS.has(c.id) && !c.code));
}

export function addCity(list, { id, title, gds, code } = {}) {
  const city = normalizeCity({
    id: id || ('c' + Date.now().toString(36)),
    title,
    gds,
    code,
    saved: false,
  });
  return [...(Array.isArray(list) ? list : []), city];
}

export function updateCity(list, id, patch) {
  return (list || []).map(c => {
    if (c.id !== id) return c;
    return normalizeCity({ ...c, ...patch, id: c.id, saved: c.saved, editing: c.editing });
  });
}

export function saveCity(list, id, patch = {}) {
  return (list || []).map(c => {
    if (c.id !== id) return c;
    const next = normalizeCity({ ...c, ...patch, id: c.id, saved: true, editing: false });
    if (!next.title) return { ...c, ...normalizeCity({ ...c, ...patch, id: c.id, saved: c.saved, editing: c.editing }) };
    return next;
  });
}

export function editCity(list, id) {
  return (list || []).map(c => c.id === id ? { ...c, editing: true } : c);
}

export function removeCity(list, id) {
  return (list || []).filter(c => c.id !== id);
}

export function persistable(list) {
  return (list || []).filter(c => c.saved).map(c => ({
    id: c.id,
    title: c.title,
    gds: c.gds,
    code: c.code,
  }));
}

export function copyValue(list, id) {
  const city = (list || []).find(c => c.id === id);
  return city ? city.code : '';
}
