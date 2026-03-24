// ══════════════════════════════════════════
// AGENDA — Eventos e calendário
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as store from '../core/store.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';
import { fmtDate } from '../core/utils.js';

let allEvents = [];
let viewYear, viewMonth; // mês sendo visualizado no calendário
let selectedDate = null; // dia clicado no calendário (filtro)

export async function loadAgenda() {
  const now = new Date();
  if (!viewYear) { viewYear = now.getFullYear(); viewMonth = now.getMonth(); }

  try {
    const { data, error } = await supabase
      .from('eventos')
      .select('*')
      .order('data_inicio', { ascending: true });
    if (error) throw error;
    allEvents = data || [];
  } catch (e) {
    console.error('Erro ao carregar eventos:', e);
    allEvents = [];
  }

  renderMiniCalendar();
  renderEventList();
  renderResumo();
}

// ── MINI CALENDÁRIO ──

function renderMiniCalendar() {
  const container = document.getElementById('agenda-calendar');
  const titleEl = document.getElementById('agenda-month-title');
  if (!container) return;

  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  if (titleEl) titleEl.textContent = `${months[viewMonth]} ${viewYear}`;

  // Dias com eventos neste mês
  const eventDays = new Set();
  allEvents.forEach(ev => {
    const d = new Date(ev.data_inicio);
    if (d.getFullYear() === viewYear && d.getMonth() === viewMonth) {
      eventDays.add(d.getDate());
    }
  });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  // Primeiro dia do mês e quantos dias
  const firstDay = new Date(viewYear, viewMonth, 1).getDay(); // 0=dom
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

  // Ajustar para semana começar em segunda
  const startOffset = (firstDay + 6) % 7;

  let html = ['Seg','Ter','Qua','Qui','Sex','Sab','Dom']
    .map(d => `<div class="cal-header">${d}</div>`).join('');

  // Dias do mês anterior
  for (let i = startOffset - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${daysInPrev - i}</div>`;
  }

  // Dias do mês
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = `${viewYear}-${viewMonth}-${d}` === todayStr;
    const isSelected = selectedDate && selectedDate.getFullYear() === viewYear && selectedDate.getMonth() === viewMonth && selectedDate.getDate() === d;
    const hasEvent = eventDays.has(d);
    const classes = ['cal-day'];
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');

    const dot = hasEvent ? '<span class="cal-dot"></span>' : '';
    html += `<div class="${classes.join(' ')}" onclick="agendaClickDay(${viewYear},${viewMonth},${d})">${d}${dot}</div>`;
  }

  // Preencher até completar a grid
  const totalCells = startOffset + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-day other-month">${i}</div>`;
  }

  container.innerHTML = html;
}

export function prevMonth() {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  selectedDate = null;
  renderMiniCalendar();
  renderEventList();
}

export function nextMonth() {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  selectedDate = null;
  renderMiniCalendar();
  renderEventList();
}

export function clickDay(year, month, day) {
  const clicked = new Date(year, month, day);
  // Toggle: se já selecionado, desselecionar
  if (selectedDate && selectedDate.getTime() === clicked.getTime()) {
    selectedDate = null;
  } else {
    selectedDate = clicked;
  }
  renderMiniCalendar();
  renderEventList();
}

// ── LISTA DE EVENTOS ──

function renderEventList() {
  const container = document.getElementById('agenda-list');
  const empty = document.getElementById('agenda-empty');
  if (!container) return;

  let events = allEvents;

  // Filtrar por dia selecionado
  if (selectedDate) {
    const sel = selectedDate.toISOString().slice(0, 10);
    events = events.filter(ev => ev.data_inicio.slice(0, 10) === sel);
  }

  if (events.length === 0) {
    container.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  const entidades = store.get('entidades') || [];
  const entMap = {};
  entidades.forEach(e => entMap[e.id] = e);

  // Agrupar por dia
  const groups = {};
  events.forEach(ev => {
    const day = ev.data_inicio.slice(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(ev);
  });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  container.innerHTML = Object.entries(groups).map(([day, evs]) => {
    let label;
    if (day === today) label = 'HOJE — ' + formatDayLabel(day);
    else if (day === tomorrow) label = 'AMANHA — ' + formatDayLabel(day);
    else label = formatDayLabel(day);

    const cards = evs.map(ev => {
      const ent = entMap[ev.entidade_id];
      const entLabel = ent ? `<span style="color:${ent.cor}">${ent.icone}</span> ${ent.nome}` : '';
      const time = ev.dia_inteiro ? 'Dia inteiro' : formatTime(ev.data_inicio);
      const local = ev.local ? ` &middot; ${esc(ev.local)}` : '';

      return `
        <div class="agenda-event-card" onclick="openEditEvent('${ev.id}')">
          <div class="agenda-event-time">${time}</div>
          <div class="agenda-event-info">
            <div class="agenda-event-title">${esc(ev.titulo)}</div>
            <div class="agenda-event-meta">${entLabel}${local}</div>
          </div>
          <div class="agenda-event-actions">
            <button class="btn-icon" onclick="event.stopPropagation();openEditEvent('${ev.id}')" title="Editar">&#x270F;&#xFE0F;</button>
            <button class="btn-icon" style="color:var(--danger)" onclick="event.stopPropagation();deleteEvent('${ev.id}')" title="Excluir">&#x1F5D1;</button>
          </div>
        </div>
      `;
    }).join('');

    return `<div class="agenda-event-group"><div class="agenda-event-group-title">${label}</div>${cards}</div>`;
  }).join('');
}

// ── RESUMO ──

function renderResumo() {
  const container = document.getElementById('agenda-resumo');
  if (!container) return;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;

  const weekCount = allEvents.filter(ev => ev.data_inicio.slice(0, 10) >= todayStr && ev.data_inicio.slice(0, 10) <= weekEnd).length;
  const monthCount = allEvents.filter(ev => ev.data_inicio.slice(0, 10) >= monthStart && ev.data_inicio.slice(0, 10) <= monthEnd).length;

  // Próximo evento
  const nextEv = allEvents.find(ev => ev.data_inicio >= now.toISOString());
  const nextLabel = nextEv
    ? `${esc(nextEv.titulo)} (${formatDayShort(nextEv.data_inicio)} ${formatTime(nextEv.data_inicio)})`
    : 'Nenhum';

  container.innerHTML = `
    <div style="margin-bottom:8px;">Esta semana: <strong>${weekCount}</strong> evento${weekCount !== 1 ? 's' : ''}</div>
    <div style="margin-bottom:8px;">Este mes: <strong>${monthCount}</strong> evento${monthCount !== 1 ? 's' : ''}</div>
    <div>Proximo: <strong>${nextLabel}</strong></div>
  `;
}

// ── CRUD ──

export function openNewEvent(preDate) {
  const entidades = store.get('entidades') || [];
  const entOptions = entidades.map(e => `<option value="${e.id}">${e.icone} ${e.nome}</option>`).join('');
  const defaultDate = preDate || (selectedDate ? selectedDate.toISOString().slice(0, 16) : '');

  modal.open('Novo evento', `
    <div class="form-group">
      <label class="form-label">Titulo *</label>
      <input type="text" class="input" id="ev-titulo" placeholder="Nome do evento">
    </div>
    <div class="form-group">
      <label class="form-label">Descricao</label>
      <textarea class="textarea" id="ev-descricao" rows="2"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Empresa</label>
      <select class="select" id="ev-entidade"><option value="">Nenhuma</option>${entOptions}</select>
    </div>
    <div class="form-group">
      <label class="toggle" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="ev-diainteiro" onchange="evToggleDiaInteiro()">
        <span class="toggle-track"></span>
        <span class="toggle-thumb"></span>
        <span style="font-size:13px;">Dia inteiro</span>
      </label>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;" id="ev-dates">
      <div class="form-group">
        <label class="form-label">Inicio *</label>
        <input type="datetime-local" class="input" id="ev-inicio" value="${defaultDate}">
      </div>
      <div class="form-group">
        <label class="form-label">Fim</label>
        <input type="datetime-local" class="input" id="ev-fim">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Local</label>
      <input type="text" class="input" id="ev-local" placeholder="Onde?">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="eventSave()">Salvar</button>
  `);
}

export function openEditEvent(id) {
  const ev = allEvents.find(e => e.id === id);
  if (!ev) return;

  openNewEvent();

  setTimeout(() => {
    const el = (s) => document.getElementById(s);
    if (el('ev-titulo')) el('ev-titulo').value = ev.titulo || '';
    if (el('ev-descricao')) el('ev-descricao').value = ev.descricao || '';
    if (el('ev-entidade')) el('ev-entidade').value = ev.entidade_id || '';
    if (el('ev-diainteiro')) el('ev-diainteiro').checked = ev.dia_inteiro || false;
    if (el('ev-inicio') && ev.data_inicio) el('ev-inicio').value = ev.data_inicio.slice(0, 16);
    if (el('ev-fim') && ev.data_fim) el('ev-fim').value = ev.data_fim.slice(0, 16);
    if (el('ev-local')) el('ev-local').value = ev.local || '';

    const title = document.querySelector('.modal-title');
    if (title) title.textContent = 'Editar evento';

    const footer = document.getElementById('modal-footer');
    if (footer) footer.innerHTML = `
      <button class="btn btn-danger btn-sm" onclick="deleteEvent('${id}')">Excluir</button>
      <div style="flex:1"></div>
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="eventSave('${id}')">Salvar</button>
    `;
  }, 10);
}

export async function saveEvent(id) {
  const titulo = document.getElementById('ev-titulo')?.value.trim();
  const inicio = document.getElementById('ev-inicio')?.value;

  if (!titulo) {
    document.getElementById('ev-titulo')?.classList.add('error');
    toast.show('Titulo e obrigatorio', 'error');
    return;
  }
  if (!inicio && !document.getElementById('ev-diainteiro')?.checked) {
    toast.show('Data de inicio e obrigatoria', 'error');
    return;
  }

  const diaInteiro = document.getElementById('ev-diainteiro')?.checked || false;
  const row = {
    titulo,
    descricao: document.getElementById('ev-descricao')?.value || null,
    entidade_id: document.getElementById('ev-entidade')?.value || null,
    dia_inteiro: diaInteiro,
    data_inicio: inicio ? new Date(inicio).toISOString() : new Date().toISOString(),
    data_fim: document.getElementById('ev-fim')?.value ? new Date(document.getElementById('ev-fim').value).toISOString() : null,
    local: document.getElementById('ev-local')?.value || null,
  };

  try {
    if (id) {
      const { error } = await supabase.from('eventos').update(row).eq('id', id);
      if (error) throw error;
      toast.show('Evento atualizado', 'success');
    } else {
      const { error } = await supabase.from('eventos').insert(row);
      if (error) throw error;
      toast.show('Evento criado', 'success');
    }
    modal.close();
    await loadAgenda();
  } catch (e) {
    console.error('Erro ao salvar evento:', e);
    toast.show('Erro ao salvar evento', 'error');
  }
}

export async function deleteEvent(id) {
  if (!confirm('Excluir este evento?')) return;
  try {
    const { error } = await supabase.from('eventos').delete().eq('id', id);
    if (error) throw error;
    toast.show('Evento excluido', 'success');
    modal.close();
    await loadAgenda();
  } catch (e) {
    console.error('Erro ao excluir evento:', e);
    toast.show('Erro ao excluir', 'error');
  }
}

export function toggleDiaInteiro() {
  const checked = document.getElementById('ev-diainteiro')?.checked;
  const dates = document.getElementById('ev-dates');
  if (!dates) return;
  const inputs = dates.querySelectorAll('input');
  inputs.forEach(i => {
    i.type = checked ? 'date' : 'datetime-local';
  });
}

// ── HELPERS ──

function formatDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

function formatDayShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
