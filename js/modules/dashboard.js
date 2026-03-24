// ══════════════════════════════════════════
// DASHBOARD — Tela inicial com dados reais
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as store from '../core/store.js';
import { fmtMoney, fmtDate } from '../core/utils.js';

let lineChart = null;
let doughnutChart = null;

export async function loadDashboard() {
  await Promise.all([
    loadStatCards(),
    loadLineChart(),
    loadDoughnutChart(),
    loadRecentTasks(),
    checkAlerts(),
  ]);
}

// ── STAT CARDS ──

async function loadStatCards() {
  try {
    const [pendentes, urgentes, eventosHoje, saldo] = await Promise.all([
      supabase.from('tarefas').select('id', { count: 'exact', head: true }).neq('status', 'concluida'),
      supabase.from('tarefas').select('id', { count: 'exact', head: true }).eq('prioridade', 'urgente').neq('status', 'concluida'),
      supabase.from('eventos').select('id', { count: 'exact', head: true }).gte('data_inicio', todayStart()).lte('data_inicio', todayEnd()),
      supabase.from('cedtec_conta_meta').select('saldo_atual').limit(1).single(),
    ]);

    setText('dash-pendentes', pendentes.count ?? 0);
    setText('dash-urgentes', urgentes.count ?? 0);
    setText('dash-eventos', eventosHoje.count ?? 0);
    setText('dash-saldo', saldo.data ? fmtMoney(saldo.data.saldo_atual) : 'N/C');
    setText('dash-saldo-sub', saldo.data ? 'saldo' : 'Nao configurado');
  } catch (e) {
    console.error('Dashboard stat cards:', e);
  }
}

// ── LINE CHART — Performance 7 dias ──

async function loadLineChart() {
  const Chart = window.Chart;
  if (!Chart) return;

  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const { data } = await supabase
      .from('tarefas')
      .select('data_conclusao')
      .gte('data_conclusao', sevenDaysAgo.toISOString())
      .not('data_conclusao', 'is', null);

    // Agrupar por dia
    const days = [];
    const labels = [];
    const counts = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push(key);
      labels.push(d.toLocaleDateString('pt-BR', { weekday: 'short' }));
      const count = (data || []).filter(t => t.data_conclusao?.slice(0, 10) === key).length;
      counts.push(count);
    }

    const ctx = document.getElementById('dash-chart-line');
    if (!ctx) return;

    if (lineChart) lineChart.destroy();

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b6af0';

    lineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Concluidas',
          data: counts,
          borderColor: accent,
          backgroundColor: accent + '26',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: accent,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, color: '#6b7280' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { ticks: { color: '#6b7280' }, grid: { display: false } }
        }
      }
    });
  } catch (e) {
    console.error('Dashboard line chart:', e);
  }
}

// ── DOUGHNUT CHART — Tarefas por empresa ──

async function loadDoughnutChart() {
  const Chart = window.Chart;
  if (!Chart) return;

  try {
    const { data: tasks } = await supabase
      .from('tarefas')
      .select('entidade_id')
      .neq('status', 'concluida');

    const entidades = store.get('entidades') || [];

    // Contar por entidade
    const countMap = {};
    (tasks || []).forEach(t => {
      const eid = t.entidade_id || 'sem';
      countMap[eid] = (countMap[eid] || 0) + 1;
    });

    const labels = [];
    const counts = [];
    const colors = [];

    entidades.forEach(e => {
      const c = countMap[e.id];
      if (c) {
        labels.push(e.icone + ' ' + e.nome);
        counts.push(c);
        colors.push(e.cor || '#6b7280');
      }
    });

    // Sem empresa
    if (countMap['sem']) {
      labels.push('Sem empresa');
      counts.push(countMap['sem']);
      colors.push('#6b7280');
    }

    const ctx = document.getElementById('dash-chart-doughnut');
    if (!ctx) return;

    if (doughnutChart) doughnutChart.destroy();

    if (counts.length === 0) {
      // Sem dados
      doughnutChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Sem tarefas'], datasets: [{ data: [1], backgroundColor: ['rgba(107,114,128,0.2)'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#6b7280' } } } }
      });
      return;
    }

    const bgPrimary = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#0f1117';

    doughnutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: counts,
          backgroundColor: colors,
          borderColor: bgPrimary,
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#9ca3af', padding: 12 } }
        }
      }
    });
  } catch (e) {
    console.error('Dashboard doughnut:', e);
  }
}

// ── TAREFAS RECENTES ──

async function loadRecentTasks() {
  try {
    const { data: tasks } = await supabase
      .from('tarefas')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(8);

    const tbody = document.getElementById('dash-tasks-body');
    const empty = document.getElementById('dash-tasks-empty');
    const table = document.getElementById('dash-tasks-table');
    if (!tbody) return;

    if (!tasks || tasks.length === 0) {
      if (table) table.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      return;
    }

    if (table) table.style.display = '';
    if (empty) empty.style.display = 'none';

    const entidades = store.get('entidades') || [];
    const entMap = {};
    entidades.forEach(e => entMap[e.id] = e);

    tbody.innerHTML = tasks.map(t => {
      const ent = entMap[t.entidade_id];
      const entLabel = ent ? `<span style="color:${ent.cor}">${ent.icone}</span> ${ent.nome}` : '—';
      const prioClass = `badge badge-prio-${t.prioridade}`;
      const statusClass = `badge badge-status-${t.status}`;
      const statusLabel = { pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluida' }[t.status] || t.status;
      const venc = t.data_vencimento ? fmtDate(t.data_vencimento) : '—';
      const vencStyle = isOverdue(t.data_vencimento, t.status) ? 'color:var(--danger)' : '';

      return `<tr style="cursor:pointer" onclick="goPage('tasks')">
        <td>${esc(t.titulo)}</td>
        <td>${entLabel}</td>
        <td><span class="${prioClass}">${t.prioridade}</span></td>
        <td><span class="${statusClass}">${statusLabel}</span></td>
        <td style="${vencStyle}">${venc}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error('Dashboard recent tasks:', e);
  }
}

// ── ALERTAS PROATIVOS ──

async function checkAlerts() {
  const container = document.getElementById('dash-alerts');
  if (!container) return;
  container.innerHTML = '';

  try {
    // Saldo Meta < 3 dias
    const { data: meta } = await supabase.from('cedtec_conta_meta').select('saldo_atual, gasto_hoje').limit(1).single();
    if (meta && meta.gasto_hoje > 0 && meta.saldo_atual > 0) {
      const dias = meta.saldo_atual / meta.gasto_hoje;
      if (dias < 3) {
        container.innerHTML += `<div class="alert alert-warning">&#x26A0;&#xFE0F; Saldo Meta para ${dias.toFixed(1)} dias — considere recarregar</div>`;
      }
    }

    // Tarefas atrasadas
    const { count: atrasadas } = await supabase
      .from('tarefas')
      .select('id', { count: 'exact', head: true })
      .lt('data_vencimento', todayStr())
      .neq('status', 'concluida');

    if (atrasadas > 0) {
      container.innerHTML += `<div class="alert alert-danger">&#x1F6A8; ${atrasadas} tarefa${atrasadas > 1 ? 's' : ''} atrasada${atrasadas > 1 ? 's' : ''}</div>`;
    }

    // Urgentes sem prazo
    const { count: semPrazo } = await supabase
      .from('tarefas')
      .select('id', { count: 'exact', head: true })
      .eq('prioridade', 'urgente')
      .is('data_vencimento', null)
      .neq('status', 'concluida');

    if (semPrazo > 0) {
      container.innerHTML += `<div class="alert alert-warning">&#x26A0;&#xFE0F; ${semPrazo} tarefa${semPrazo > 1 ? 's' : ''} urgente${semPrazo > 1 ? 's' : ''} sem prazo definido</div>`;
    }
  } catch (e) {
    console.error('Dashboard alerts:', e);
  }
}

// ── HELPERS ──

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayEnd() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(dateStr, status) {
  if (!dateStr || status === 'concluida') return false;
  return dateStr < todayStr();
}
