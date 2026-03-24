// ══════════════════════════════════════════
// ROUTER — Navegação entre páginas
// ══════════════════════════════════════════

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  chat:      'Chat IA',
  tasks:     'Tarefas',
  agenda:    'Agenda',
  docs:      'Documentos',
  cedtec:    'CEDTEC',
  sitio:     'Sitio',
  config:    'Configuracoes',
};

let currentPage = 'dashboard';

export function goPage(pageId) {
  if (!PAGE_TITLES[pageId]) return;

  // Esconde todas as páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Mostra a correta
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.add('active');

  // Atualiza título do header
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = PAGE_TITLES[pageId];

  // Atualiza nav ativa
  document.querySelectorAll('.sidebar-nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === pageId);
  });

  // Fecha sidebar em mobile
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (window.innerWidth < 768) {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('show');
  }

  currentPage = pageId;
}

export function getCurrentPage() {
  return currentPage;
}
