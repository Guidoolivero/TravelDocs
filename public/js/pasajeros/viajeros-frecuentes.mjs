export function getFFNEntries() {
  return Array.from(document.querySelectorAll('#ffn-list .ffn-row')).map(row => ({
    airline: row.querySelector('.ffn-airline')?.value?.trim().toUpperCase() || '',
    number:  row.querySelector('.ffn-number')?.value?.trim() || '',
  })).filter(e => e.airline && e.number);
}
