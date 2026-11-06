import { getGdsCities, saveGdsCities } from '../db.js';
import { escStr } from '../compartido/utils.js';
import { fromStorage, addCity, updateCity, saveCity, editCity, removeCity, persistable, copyValue } from './gds-cities.mjs';
import { esc, showToast } from '../compartido/ui.mjs';


// ==================== CIUDADES GDS ====================
let gdsCities = [];

function paintGdsCities() {
  const list = document.getElementById('gds-cities-list');
  if (!list) return;
  list.innerHTML = gdsCities.map(c => {
    const gdsLabel = c.gds === 'sabre' ? 'Sabre' : 'Amadeus';
    if (c.saved && !c.editing) {
      return `<div class="gds-city-card" data-city-id="${escStr(c.id)}">
        <div class="gds-city-gds">${esc(c.title)}<small>${gdsLabel}</small></div>
        <input type="text" data-city-code autocomplete="off" spellcheck="false" placeholder="Codigo de ciudad" value="${escStr(c.code)}" aria-label="Codigo ${escStr(c.title)}">
        <button type="button" class="copy-btn" data-city-copy>copiar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-city-edit>Editar</button>
        <button type="button" class="gds-city-remove" data-city-remove aria-label="Quitar ciudad">x</button>
      </div>`;
    }
    return `<div class="gds-city-card draft" data-city-id="${escStr(c.id)}">
      <input type="text" data-city-title autocomplete="off" placeholder="Ej. Ciudad Ricale" value="${escStr(c.title)}" aria-label="Titulo">
      <select data-city-gds aria-label="GDS">
        <option value="amadeus"${c.gds === 'amadeus' ? ' selected' : ''}>Amadeus</option>
        <option value="sabre"${c.gds === 'sabre' ? ' selected' : ''}>Sabre</option>
      </select>
      <input type="text" data-city-code autocomplete="off" spellcheck="false" placeholder="Codigo de ciudad" value="${escStr(c.code)}" aria-label="Codigo de ciudad">
      <button type="button" class="btn btn-primary btn-sm" data-city-save>Guardar</button>
      <button type="button" class="gds-city-remove" data-city-remove aria-label="Quitar ciudad">x</button>
    </div>`;
  }).join('');
}

async function persistGdsCities() {
  try {
    await saveGdsCities(persistable(gdsCities));
  } catch (err) {
    console.warn('[Ciudades] No se pudo guardar:', err?.message || err);
    showToast('No se pudieron guardar las ciudades.', true);
  }
}

function scheduleSaveGdsCities() {
  clearTimeout(scheduleSaveGdsCities._t);
  scheduleSaveGdsCities._t = setTimeout(() => persistGdsCities(), 400);
}

function cityIsSaved(id) {
  return gdsCities.some(c => c.id === id && c.saved);
}

async function loadGdsCities() {
  const list = document.getElementById('gds-cities-list');
  if (list && !gdsCities.length) list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px;">Cargando…</div>';
  try {
    gdsCities = fromStorage(await getGdsCities());
  } catch (err) {
    console.warn('[Ciudades] No se pudo leer:', err?.message || err);
    gdsCities = [];
  }
  paintGdsCities();
}
export function initCiudades() {
  document.getElementById('gds-cities-list')?.addEventListener('input', e => {
    const card = e.target.closest('[data-city-id]');
    if (!card) return;
    const id = card.dataset.cityId;
    if (e.target.matches('[data-city-code]')) {
      gdsCities = updateCity(gdsCities, id, { code: e.target.value });
      if (cityIsSaved(id)) scheduleSaveGdsCities();
    } else if (e.target.matches('[data-city-title]')) {
      gdsCities = updateCity(gdsCities, id, { title: e.target.value });
    }
  });

  document.getElementById('gds-cities-list')?.addEventListener('change', e => {
    const card = e.target.closest('[data-city-id]');
    if (!card || !e.target.matches('[data-city-gds]')) return;
    gdsCities = updateCity(gdsCities, card.dataset.cityId, { gds: e.target.value });
  });

  document.getElementById('gds-cities-list')?.addEventListener('click', e => {
    const card = e.target.closest('[data-city-id]');
    if (!card) return;
    const id = card.dataset.cityId;
    if (e.target.closest('[data-city-copy]')) {
      window.copyText(e.target.closest('[data-city-copy]'), copyValue(gdsCities, id));
      return;
    }
    if (e.target.closest('[data-city-edit]')) {
      gdsCities = editCity(gdsCities, id);
      paintGdsCities();
      document.querySelector(`#gds-cities-list [data-city-id="${CSS.escape(id)}"] [data-city-title]`)?.focus();
      return;
    }
    if (e.target.closest('[data-city-save]')) {
      const title = card.querySelector('[data-city-title]')?.value || '';
      const gds = card.querySelector('[data-city-gds]')?.value || 'amadeus';
      const code = card.querySelector('[data-city-code]')?.value || '';
      const next = saveCity(gdsCities, id, { title, gds, code });
      if (!next.find(c => c.id === id)?.saved) {
        showToast('Poné un titulo para guardar.', true);
        return;
      }
      gdsCities = next;
      paintGdsCities();
      persistGdsCities();
      return;
    }
    if (e.target.closest('[data-city-remove]')) {
      gdsCities = removeCity(gdsCities, id);
      paintGdsCities();
      persistGdsCities();
    }
  });

  document.getElementById('btn-gds-city-add')?.addEventListener('click', () => {
    gdsCities = addCity(gdsCities, { gds: 'amadeus' });
    paintGdsCities();
    const titles = document.querySelectorAll('#gds-cities-list [data-city-title]');
    titles[titles.length - 1]?.focus();
  });


}

export { loadGdsCities };
