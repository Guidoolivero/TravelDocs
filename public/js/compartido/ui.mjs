// Escapa HTML para prevenir XSS al renderizar datos de pasajeros
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ==================== CONFIRM / DELETE ====================
function showConfirmDialog({ title, message, subtext = '', confirmLabel = 'Confirmar', onConfirm }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = message;
  document.getElementById('confirm-subtext').textContent = subtext;
  document.getElementById('confirm-ok-btn').textContent = confirmLabel;
  document.getElementById('confirm-ok-btn').onclick = async () => {
    closeModal('modal-confirm');
    await onConfirm();
  };
  openModal('modal-confirm');
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const inner = document.getElementById('toast-text');
  inner.textContent = msg;
  inner.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}
export function initUi() {
  // ==================== MODAL ====================
  window.openModal = function(id) {
    document.getElementById(id)?.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeModal = function(id) {
    document.getElementById(id)?.classList.remove('open');
    // Restaurar scroll solo si no hay otros modales abiertos
    if (!document.querySelector('.modal-overlay.open')) {
      document.body.style.overflow = '';
    }
  };

  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', function(e) { if (e.target === this) closeModal(this.id); });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id));
  });

  // ==================== UTILS UI ====================
  window.copyText = function(btn, text) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'copiar'; btn.classList.remove('copied'); }, 1500);
    });
  };
}

export { esc, showConfirmDialog, showToast };
