export function normScanValue(v) {
  return (v || '').toString().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

export function normScanNumber(v) {
  return (v || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}
