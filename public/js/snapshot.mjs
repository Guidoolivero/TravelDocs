export function snapshotFingerprint(docs) {
  return (docs || []).map(d => {
    const t = d.updatedAt;
    let stamp = '';
    if (t && typeof t === 'object' && t.seconds != null) {
      stamp = `${t.seconds}.${t.nanoseconds || 0}`;
    } else if (t != null) {
      stamp = String(t);
    }
    return `${d.id}:${stamp}`;
  }).join('|');
}

export function snapshotChanged(prevFp, docs) {
  const fp = snapshotFingerprint(docs);
  return { fp, changed: prevFp === null || fp !== prevFp };
}
