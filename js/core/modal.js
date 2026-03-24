// ══════════════════════════════════════════
// MODAL — Sistema de modais
// ══════════════════════════════════════════

const overlay = () => document.getElementById('modal-overlay');
const titleEl = () => document.getElementById('modal-title');
const bodyEl = () => document.getElementById('modal-body');
const footerEl = () => document.getElementById('modal-footer');

export function open(title, bodyHTML, footerHTML = '') {
  titleEl().textContent = title;
  bodyEl().innerHTML = bodyHTML;
  footerEl().innerHTML = footerHTML;
  overlay().classList.add('show');
}

export function close() {
  overlay().classList.remove('show');
  bodyEl().innerHTML = '';
  footerEl().innerHTML = '';
}

// Fechar com Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay().classList.contains('show')) {
    close();
  }
});

// Fechar com click no overlay
document.addEventListener('click', (e) => {
  if (e.target === overlay()) {
    close();
  }
});
