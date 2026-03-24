// ══════════════════════════════════════════
// TAREFAS — Kanban com drag & drop
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as store from '../core/store.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';
import { fmtDate } from '../core/utils.js';

const STATUSES = ['pendente', 'em_andamento', 'concluida'];
const PRIO_ORDER = { urgente: 0, alta: 1, media: 2, baixa: 3 };
let allTasks = [];
let filterEntidade = null;
let reminderTimers = [];

// ── LOAD ──

export async function loadTasks() {
  try {
    const { data, error } = await supabase
      .from('tarefas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    allTasks = data || [];
  } catch (e) {
    console.error('Erro ao carregar tarefas:', e);
    allTasks = [];
  }

  renderFilter();
  renderKanban();
  setupDragDrop();
  scheduleReminders(allTasks);
}

// ── FILTRO POR EMPRESA ──

function renderFilter() {
  const container = document.getElementById('tasks-filter');
  if (!container) return;
  const entidades = store.get('entidades') || [];

  container.innerHTML = `
    <button class="chip ${!filterEntidade ? 'active' : ''}" onclick="tasksFilter(null)">Todas</button>
    ${entidades.map(e => `
      <button class="chip ${filterEntidade === e.id ? 'active' : ''}" onclick="tasksFilter('${e.id}')">
        ${e.icone} ${e.nome}
      </button>
    `).join('')}
  `;
}

export function filterTasks(entidadeId) {
  filterEntidade = entidadeId || null;
  renderFilter();
  renderKanban();
}

// ── RENDER KANBAN ──

function renderKanban() {
  const filtered = filterEntidade
    ? allTasks.filter(t => t.entidade_id === filterEntidade)
    : allTasks;

  const kanban = document.getElementById('tasks-kanban');
  const empty = document.getElementById('tasks-empty');

  if (filtered.length === 0 && !filterEntidade) {
    if (kanban) kanban.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (kanban) kanban.style.display = '';
  if (empty) empty.style.display = 'none';

  const entidades = store.get('entidades') || [];
  const entMap = {};
  entidades.forEach(e => entMap[e.id] = e);

  // Urgentes badge
  const urgCount = filtered.filter(t => t.prioridade === 'urgente' && t.status !== 'concluida').length;
  const urgBadge = document.getElementById('tasks-urgente-badge');
  if (urgBadge) {
    if (urgCount > 0) {
      urgBadge.textContent = `${urgCount} urgente${urgCount > 1 ? 's' : ''}`;
      urgBadge.style.display = '';
    } else {
      urgBadge.style.display = 'none';
    }
  }

  STATUSES.forEach(status => {
    const cards = filtered
      .filter(t => t.status === status)
      .sort((a, b) => (PRIO_ORDER[a.prioridade] ?? 2) - (PRIO_ORDER[b.prioridade] ?? 2));

    const container = document.getElementById(`cards-${status}`);
    const count = document.getElementById(`count-${status}`);
    if (count) count.textContent = cards.length;
    if (!container) return;

    if (cards.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:24px 0;"><p class="empty-state-text" style="font-size:12px;">Nenhuma tarefa aqui</p></div>`;
      return;
    }

    container.innerHTML = cards.map(t => renderTaskCard(t, entMap[t.entidade_id])).join('');
  });
}

function renderTaskCard(task, entidade) {
  const prioClass = `badge badge-prio-${task.prioridade}`;
  const entLabel = entidade
    ? `<span class="kanban-card-ent" style="color:${entidade.cor}">${entidade.icone} ${entidade.nome}</span>`
    : '';
  const venc = task.data_vencimento ? fmtDate(task.data_vencimento) : '';
  const isOverdue = task.data_vencimento && task.data_vencimento < new Date().toISOString().slice(0, 10) && task.status !== 'concluida';
  const vencHTML = venc ? `<span style="${isOverdue ? 'color:var(--danger)' : ''}">${venc}</span>` : '';
  const reminder = task.lembrete_em ? '&#x1F514;' : '';

  // Botões de mover (mobile)
  const moveButtons = STATUSES
    .filter(s => s !== task.status)
    .map(s => {
      const label = { pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluida' }[s];
      return `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();moveTask('${task.id}','${s}')">${label}</button>`;
    }).join('');

  return `
    <div class="kanban-card" draggable="true" data-id="${task.id}"
         onclick="openEditTask('${task.id}')">
      <span class="${prioClass}">${task.prioridade}</span>
      <div class="kanban-card-title">${esc(task.titulo)}</div>
      <div class="kanban-card-meta">
        ${entLabel} ${vencHTML} ${reminder}
      </div>
      <div class="kanban-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditTask('${task.id}')">Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="event.stopPropagation();deleteTask('${task.id}')">Excluir</button>
      </div>
      <div class="kanban-card-move">${moveButtons}</div>
    </div>
  `;
}

// ── DRAG & DROP ──

function setupDragDrop() {
  document.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (id && newStatus) moveTask(id, newStatus);
    });
  });

  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    card.classList.add('dragging');
    setTimeout(() => card.classList.remove('dragging'), 0);
  });
}

// ── MOBILE: mostrar coluna ──

export function showCol(status) {
  STATUSES.forEach(s => {
    const col = document.getElementById(`col-${s}`);
    if (col) col.style.display = s === status ? '' : 'none';
  });
  document.querySelectorAll('#tasks-mobile-tabs .tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent.trim().toLowerCase().replace(/ /g, '_').startsWith(status.replace('_', ' ').split(' ')[0]));
  });
  // Simpler: just match by index
  const tabs = document.querySelectorAll('#tasks-mobile-tabs .tab');
  const idx = STATUSES.indexOf(status);
  tabs.forEach((t, i) => t.classList.toggle('active', i === idx));
}

// ── CRUD ──

export function openNewTask() {
  const entidades = store.get('entidades') || [];
  const entOptions = entidades.map(e => `<option value="${e.id}">${e.icone} ${e.nome}</option>`).join('');

  modal.open('Nova tarefa', `
    <div class="form-group">
      <label class="form-label">Titulo *</label>
      <input type="text" class="input" id="task-titulo" placeholder="O que precisa fazer?">
    </div>
    <div class="form-group">
      <label class="form-label">Descricao</label>
      <textarea class="textarea" id="task-descricao" rows="2"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Empresa</label>
      <select class="select" id="task-entidade"><option value="">Nenhuma</option>${entOptions}</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Prioridade</label>
        <select class="select" id="task-prioridade">
          <option value="baixa">Baixa</option>
          <option value="media" selected>Media</option>
          <option value="alta">Alta</option>
          <option value="urgente">Urgente</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="select" id="task-status">
          <option value="pendente">Pendente</option>
          <option value="em_andamento">Em andamento</option>
          <option value="concluida">Concluida</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group">
        <label class="form-label">Vencimento</label>
        <input type="date" class="input" id="task-vencimento">
      </div>
      <div class="form-group">
        <label class="form-label">Lembrete</label>
        <input type="datetime-local" class="input" id="task-lembrete">
      </div>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="taskSave()">Salvar</button>
  `);
}

export function openEditTask(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;

  openNewTask(); // Reutiliza o modal

  // Preencher
  setTimeout(() => {
    const el = (sel) => document.getElementById(sel);
    if (el('task-titulo')) el('task-titulo').value = task.titulo || '';
    if (el('task-descricao')) el('task-descricao').value = task.descricao || '';
    if (el('task-entidade')) el('task-entidade').value = task.entidade_id || '';
    if (el('task-prioridade')) el('task-prioridade').value = task.prioridade || 'media';
    if (el('task-status')) el('task-status').value = task.status || 'pendente';
    if (el('task-vencimento')) el('task-vencimento').value = task.data_vencimento || '';
    if (el('task-lembrete') && task.lembrete_em) el('task-lembrete').value = task.lembrete_em.slice(0, 16);

    // Mudar título e botão
    const title = document.querySelector('.modal-title');
    if (title) title.textContent = 'Editar tarefa';

    const footer = document.getElementById('modal-footer');
    if (footer) footer.innerHTML = `
      <button class="btn btn-danger btn-sm" onclick="deleteTask('${id}')">Excluir</button>
      <div style="flex:1"></div>
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="taskSave('${id}')">Salvar</button>
    `;
  }, 10);
}

export async function saveTask(id) {
  const titulo = document.getElementById('task-titulo')?.value.trim();
  if (!titulo) {
    const el = document.getElementById('task-titulo');
    if (el) el.classList.add('error');
    toast.show('Titulo e obrigatorio', 'error');
    return;
  }

  const status = document.getElementById('task-status')?.value || 'pendente';
  const row = {
    titulo,
    descricao: document.getElementById('task-descricao')?.value || null,
    entidade_id: document.getElementById('task-entidade')?.value || null,
    prioridade: document.getElementById('task-prioridade')?.value || 'media',
    status,
    data_vencimento: document.getElementById('task-vencimento')?.value || null,
    lembrete_em: document.getElementById('task-lembrete')?.value ? new Date(document.getElementById('task-lembrete').value).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  // Se concluida, preencher data_conclusao
  if (status === 'concluida') {
    row.data_conclusao = new Date().toISOString();
  } else {
    row.data_conclusao = null;
  }

  try {
    if (id) {
      const { error } = await supabase.from('tarefas').update(row).eq('id', id);
      if (error) throw error;
      toast.show('Tarefa atualizada', 'success');
    } else {
      const { error } = await supabase.from('tarefas').insert(row);
      if (error) throw error;
      toast.show('Tarefa criada', 'success');
    }
    modal.close();
    await loadTasks();
  } catch (e) {
    console.error('Erro ao salvar tarefa:', e);
    toast.show('Erro ao salvar tarefa', 'error');
  }
}

export async function deleteTask(id) {
  if (!confirm('Excluir esta tarefa?')) return;
  try {
    const { error } = await supabase.from('tarefas').delete().eq('id', id);
    if (error) throw error;
    toast.show('Tarefa excluida', 'success');
    modal.close();
    await loadTasks();
  } catch (e) {
    console.error('Erro ao excluir tarefa:', e);
    toast.show('Erro ao excluir', 'error');
  }
}

export async function moveTask(id, newStatus) {
  try {
    const updates = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'concluida') updates.data_conclusao = new Date().toISOString();
    else updates.data_conclusao = null;

    const { error } = await supabase.from('tarefas').update(updates).eq('id', id);
    if (error) throw error;
    await loadTasks();
  } catch (e) {
    console.error('Erro ao mover tarefa:', e);
    toast.show('Erro ao mover tarefa', 'error');
  }
}

// ── LEMBRETES ──

function scheduleReminders(tasks) {
  // Limpar timers anteriores
  reminderTimers.forEach(t => clearTimeout(t));
  reminderTimers = [];

  const now = Date.now();
  tasks.forEach(t => {
    if (!t.lembrete_em || t.status === 'concluida') return;
    const ms = new Date(t.lembrete_em).getTime() - now;
    if (ms > 0 && ms < 3600000 * 24) { // máx 24h à frente
      const timer = setTimeout(() => dispararAlarme(t), ms);
      reminderTimers.push(timer);
    }
  });
}

function dispararAlarme(task) {
  toast.show(`&#x1F514; Lembrete: ${task.titulo}`, 'warning');

  // Web Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Lembrete', { body: task.titulo, icon: '/icon-192.png' });
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') new Notification('Lembrete', { body: task.titulo, icon: '/icon-192.png' });
    });
  }
}

// Reavaliar lembretes a cada 60 min
setInterval(() => {
  if (allTasks.length > 0) scheduleReminders(allTasks);
}, 60 * 60 * 1000);

// ── HELPERS ──

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
