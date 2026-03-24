// ══════════════════════════════════════════
// APP.JS — Entry point + Auth + Window Bridge
// ══════════════════════════════════════════

import { supabase } from './core/supabase.js';
import * as router from './core/router.js';
import * as modal from './core/modal.js';
import * as toast from './core/toast.js';
import * as store from './core/store.js';
import * as utils from './core/utils.js';

// Módulos (importar conforme implementados)
import * as dashboard from './modules/dashboard.js';
import * as tasks from './modules/tasks.js';
import * as agenda from './modules/agenda.js';
// import * as docs from './modules/docs.js';
// import * as chat from './modules/chat.js';
// import * as sitio from './modules/sitio.js';
// import * as cedtec from './modules/cedtec.js';
// import * as config from './modules/config.js';

// ── FLAG DE INICIALIZAÇÃO ──
let appInitialized = false;

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

supabase.auth.onAuthStateChange((event, session) => {
  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    if (!appInitialized) {
      appInitialized = true;
      initApp(session);
    }
  }
  if (event === 'SIGNED_OUT') {
    appInitialized = false;
    showLogin();
  }
});

async function signIn() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');

  if (!email || !password) {
    toast.show('Preencha email e senha', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Entrando...';

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    toast.show('Email ou senha incorretos', 'error');
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
  // Se ok: onAuthStateChange vai chamar initApp automaticamente
}

function signOut() {
  supabase.auth.signOut();
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  // Limpar campos
  const emailEl = document.getElementById('login-email');
  const passEl = document.getElementById('login-password');
  const btnEl = document.getElementById('login-btn');
  if (emailEl) emailEl.value = '';
  if (passEl) passEl.value = '';
  if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Entrar'; }
}

async function initApp(session) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setupTheme();
  setupKeyboard();
  await loadEntidades();
  router.goPage('dashboard');
  dashboard.loadDashboard();
}

// ══════════════════════════════════════════
// ENTIDADES — carrega empresas do banco
// ══════════════════════════════════════════

async function loadEntidades() {
  try {
    const { data, error } = await supabase
      .from('entidades')
      .select('*')
      .order('ordem', { ascending: true });
    if (error) throw error;
    store.set('entidades', data || []);
  } catch (e) {
    console.error('Erro ao carregar entidades:', e);
    store.set('entidades', []);
  }
}

// ══════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('show');
}

// ══════════════════════════════════════════
// TEMA
// ══════════════════════════════════════════

function setupTheme() {
  const saved = localStorage.getItem('assistente-theme');
  if (saved === 'light') document.documentElement.classList.add('light');
}

function toggleTheme() {
  document.documentElement.classList.toggle('light');
  const isLight = document.documentElement.classList.contains('light');
  localStorage.setItem('assistente-theme', isLight ? 'light' : 'dark');
}

// ══════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Não capturar se estiver em input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    switch (e.key) {
      case 'N': case 'n':
        if (router.getCurrentPage() === 'tasks') tasks.openNewTask();
        break;
      case 'E': case 'e':
        if (router.getCurrentPage() === 'agenda') agenda.openNewEvent();
        break;
    }
  });
}

// Enter no campo de senha faz login
document.getElementById('login-password')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') signIn();
});

// ══════════════════════════════════════════
// WINDOW BRIDGE — OBRIGATÓRIO
// Toda função usada em onclick no HTML
// ══════════════════════════════════════════

// AUTH
window.signIn = signIn;
window.signOut = signOut;

// NAVEGAÇÃO
window.goPage = (page) => {
  router.goPage(page);
  // Carregar módulo ao navegar
  if (page === 'dashboard') dashboard.loadDashboard();
  if (page === 'tasks') tasks.loadTasks();
  if (page === 'agenda') agenda.loadAgenda();
};
window.toggleSidebar = toggleSidebar;

// MODAL
window.closeModal = () => modal.close();

// TOAST
window.showToast = (msg, type) => toast.show(msg, type);

// TEMA
window.toggleTheme = toggleTheme;

// TAREFAS
window.openNewTask = () => tasks.openNewTask();
window.openEditTask = (id) => tasks.openEditTask(id);
window.deleteTask = (id) => tasks.deleteTask(id);
window.moveTask = (id, status) => tasks.moveTask(id, status);
window.taskSave = (id) => tasks.saveTask(id);
window.tasksFilter = (id) => tasks.filterTasks(id);
window.tasksShowCol = (status) => tasks.showCol(status);

// AGENDA
window.openNewEvent = () => agenda.openNewEvent();
window.openEditEvent = (id) => agenda.openEditEvent(id);
window.deleteEvent = (id) => agenda.deleteEvent(id);
window.eventSave = (id) => agenda.saveEvent(id);
window.agendaPrevMonth = () => agenda.prevMonth();
window.agendaNextMonth = () => agenda.nextMonth();
window.agendaClickDay = (y, m, d) => agenda.clickDay(y, m, d);
window.evToggleDiaInteiro = () => agenda.toggleDiaInteiro();

// DOCUMENTOS (quando implementado)
// window.openNewFolder = () => docs.openNewFolder();
// window.navigateFolder = (id) => docs.navigateFolder(id);
// window.triggerUpload = () => docs.triggerUpload();
// window.downloadDoc = (id) => docs.downloadDoc(id);
// window.deleteDoc = (id) => docs.deleteDoc(id);
// window.openFileViewer = (url, tipo) => docs.openFileViewer(url, tipo);
// window.shareDoc = (id) => docs.shareDoc(id);

// CHAT (quando implementado)
// window.sendMsg = () => chat.sendMsg();
// window.clearChat = () => chat.clearChat();
// window.toggleMic = () => chat.toggleMic();
// window.selectAgente = (slug) => chat.selectAgente(slug);
// window.saveMemoria = (agenteSlug, texto) => chat.saveMemoria(agenteSlug, texto);

// SÍTIO (quando implementado)
// window.sitioTab = (tab) => sitio.tab(tab);
// window.openNewLanc = () => sitio.openNewLanc();
// window.openEditLanc = (id) => sitio.openEditLanc(id);
// window.deleteLanc = (id) => sitio.deleteLanc(id);
// window.openNewCentro = () => sitio.openNewCentro();
// window.openEditCentro = (id) => sitio.openEditCentro(id);
// window.deleteCentro = (id) => sitio.deleteCentro(id);

// CEDTEC (quando implementado)
// window.cedtecTab = (tab) => cedtec.tab(tab);
// window.cedtecSyncMeta = () => cedtec.syncMeta();

// CONFIGURAÇÕES (quando implementado)
// window.configTab = (tab) => config.tab(tab);
// window.openNewAgente = () => config.openNewAgente();
// window.openEditAgente = (id) => config.openEditAgente(id);
// window.toggleAgente = (id, ativo) => config.toggleAgente(id, ativo);
// window.uploadAgentePhoto = (id) => config.uploadAgentePhoto(id);
// window.uploadAgenteFile = (id) => config.uploadAgenteFile(id);
// window.deleteMemoriaAgente = (id, idx) => config.deleteMemoria(id, idx);
