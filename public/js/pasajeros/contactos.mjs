export function emergencyContactsOf(p) {
  const list = Array.isArray(p?.emergencyContacts) ? p.emergencyContacts : [];
  const filled = list.filter(c => c && Object.values(c).some(Boolean));
  if (filled.length) return filled;
  const one = p?.emergencyContact;
  return one && Object.values(one).some(Boolean) ? [one] : [];
}
