// ══════════════════════════════════════════
// TOAST — Notificações
// ══════════════════════════════════════════

const ICONS = {
  success: '\u2713',
  error:   '\u2715',
  warning: '\u26A0',
  info:    '\u2139',
};

const MAX_VISIBLE = 3;
const AUTO_REMOVE_MS = 3000;

export function show(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Limitar a MAX_VISIBLE
  while (container.children.length >= MAX_VISIBLE) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${ICONS[type] || ICONS.info}</span>
    <span class="toast-msg">${msg}</span>
  `;

  container.appendChild(toast);

  // Auto-remove
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, AUTO_REMOVE_MS);
}
