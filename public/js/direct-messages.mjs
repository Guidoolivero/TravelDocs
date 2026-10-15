// Mensajes directos: se muestran UNA sola vez, en un modal, al usuario cuyo
// email coincide (ver maybeShowDirectMessage en app.mjs). Para agregar uno,
// sumar un objeto a la lista con un id unico.
export const DIRECT_MESSAGES = [
  {
    id: 'gracias-natalia-2026-09',
    email: 'natalia@transitarviajes.com.ar',
    paragraphs: [
      'Hola Natalia, me alegro mucho que te guste el sistema.',
      'Si se te ocurre algo para mejorarlo no dudes en escribirme.',
    ],
    signature: ['Guido', 'TravelDocs'],
  },
];

export function findDirectMessage(list, email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return null;
  return (list || []).find(m => String(m.email || '').toLowerCase().trim() === e) || null;
}
