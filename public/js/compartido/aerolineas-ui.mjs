import { nombreAerolinea } from './airlines.mjs';
import { esc } from './ui.mjs';

export function _airlineBadgeHtml(code) {
  if (!code || code.length < 2) return '';
  const nombre = nombreAerolinea(code);
  return nombre
    ? `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--green-bg);color:var(--green);border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;white-space:nowrap;">${esc(code)} - ${esc(nombre)}</span>`
    : `<span style="color:var(--text3);font-size:11px;">Código no reconocido</span>`;
}

export function _deriveCompania(vuelo) {
  const m = (vuelo || '').match(/^([A-Z0-9]{2})\d/);
  return m ? m[1] : '';
}
