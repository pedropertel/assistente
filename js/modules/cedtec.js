// ══════════════════════════════════════════
// CEDTEC — Meta Ads, saldo, campanhas, funil
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';
import { fmtMoney, fmtDate } from '../core/utils.js';

let contaMeta = null;
let campanhas = [];
let recargas = [];
let conexao = null;
let activeTab = 'visao';
let gastoLeadsChart = null;
let balanceInterval = null;

export async function loadCedtec() {
  try {
    const [metaRes, campRes, recRes, conRes] = await Promise.all([
      supabase.from('cedtec_conta_meta').select('*').limit(1).single(),
      supabase.from('meta_campanhas_cache').select('*').order('gasto', { ascending: false }),
      supabase.from('cedtec_recargas').select('*').order('data', { ascending: false }),
      supabase.from('meta_conexoes').select('*').limit(1).single(),
    ]);
    contaMeta = metaRes.data;
    campanhas = campRes.data || [];
    recargas = recRes.data || [];
    conexao = conRes.data;
  } catch (e) {
    console.error('Erro ao carregar CEDTEC:', e);
  }
  checkAlerts();
  renderTab();

  // Auto-fetch saldo ao abrir
  fetchBalanceAuto();

  // Polling a cada 5 minutos enquanto modulo aberto
  if (balanceInterval) clearInterval(balanceInterval);
  balanceInterval = setInterval(fetchBalanceAuto, 5 * 60 * 1000);
}

async function fetchBalanceAuto() {
  if (!conexao || conexao.status === 'desconectado') return;
  try {
    const { data, error } = await supabase.functions.invoke('meta-balance');
    if (error) { console.warn('Meta balance auto-fetch error:', error); return; }
    if (data && !data.error) {
      contaMeta = { ...contaMeta, saldo_atual: data.saldo_atual, gasto_hoje: data.gasto_hoje, gasto_mes: data.gasto_mes };
      renderTab();
      updateLastSync();
    }
  } catch (e) {
    console.warn('Meta balance auto-fetch error:', e);
  }
}

function updateLastSync() {
  const el = document.getElementById('cedtec-last-sync');
  if (el) el.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

// ── TABS ──

export function tab(t) {
  activeTab = t;
  const tabs = ['visao', 'saldo', 'campanhas', 'funil', 'marcos'];
  document.querySelectorAll('#page-cedtec .tab').forEach((el, i) => {
    el.classList.toggle('active', tabs[i] === t);
  });
  tabs.forEach(id => {
    const el = document.getElementById(`cedtec-tab-${id}`);
    if (el) el.style.display = id === t ? '' : 'none';
  });
  renderTab();
}

function renderTab() {
  switch (activeTab) {
    case 'visao': renderVisaoGeral(); break;
    case 'saldo': renderSaldoMeta(); break;
    case 'campanhas': renderCampanhas(); break;
  }
}

// ── ALERTAS ──

function checkAlerts() {
  const banner = document.getElementById('cedtec-alert-banner');
  if (!banner) return;
  banner.innerHTML = '';

  if (conexao && conexao.status === 'desconectado') {
    banner.innerHTML += `<div class="alert alert-danger">&#x1F6A8; Meta Ads nao configurado — va em Configuracoes para conectar</div>`;
  }
}

// ── VISÃO GERAL ──

function renderVisaoGeral() {
  const saldo = contaMeta?.saldo_atual || 0;
  const gastoHoje = contaMeta?.gasto_hoje || 0;
  const gastoMes = contaMeta?.gasto_mes || 0;
  const mediaDiaria = gastoMes > 0 ? gastoMes / new Date().getDate() : gastoHoje;
  const diasRestantes = mediaDiaria > 0 ? (saldo / mediaDiaria).toFixed(1) : '—';

  const statsEl = document.getElementById('cedtec-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card" onclick="cedtecTab('saldo')"><div class="stat-card-header"><span class="stat-card-icon">&#x1F4B0;</span><span class="stat-card-label">Saldo Meta</span></div><div class="stat-card-value">${fmtMoney(saldo)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x1F4C8;</span><span class="stat-card-label">Gasto hoje</span></div><div class="stat-card-value">${fmtMoney(gastoHoje)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x1F4C5;</span><span class="stat-card-label">Gasto mes</span></div><div class="stat-card-value">${fmtMoney(gastoMes)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x23F3;</span><span class="stat-card-label">Dias restantes</span></div><div class="stat-card-value">${diasRestantes}</div></div>
    `;
  }

  // Alerta saldo baixo
  const alertEl = document.getElementById('cedtec-saldo-alert');
  if (alertEl) {
    if (mediaDiaria > 0 && saldo / mediaDiaria < 3) {
      alertEl.innerHTML = `<div class="alert alert-warning" style="margin-bottom:16px;">&#x26A0;&#xFE0F; Saldo para ${diasRestantes} dias — considere recarregar</div>`;
    } else {
      alertEl.innerHTML = '';
    }
  }

  // Top campanhas
  const topEl = document.getElementById('cedtec-top-campanhas');
  if (topEl) {
    const top3 = campanhas.slice(0, 3);
    if (top3.length === 0) {
      topEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Nenhuma campanha — sincronize primeiro</p>';
    } else {
      topEl.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Campanha</th><th>Gasto</th><th>Leads</th><th>CPL</th></tr></thead>
        <tbody>${top3.map(c => {
          const cplStyle = isCplAlto(c.cpl) ? 'color:var(--danger);font-weight:600;' : '';
          return `<tr><td>${esc(c.nome)}</td><td>${fmtMoney(c.gasto)}</td><td>${c.leads || 0}</td><td style="${cplStyle}">${fmtMoney(c.cpl)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`;
    }
  }

  // Gráfico gasto vs leads (placeholder se não tem dados)
  renderGastoLeadsChart();
}

function renderGastoLeadsChart() {
  const Chart = window.Chart;
  if (!Chart) return;
  const ctx = document.getElementById('cedtec-chart-gastoLeads');
  if (!ctx) return;
  if (gastoLeadsChart) gastoLeadsChart.destroy();

  if (campanhas.length === 0) {
    // Sem dados
    gastoLeadsChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: ['Sem dados'], datasets: [{ data: [0], backgroundColor: 'rgba(107,114,128,0.2)' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    return;
  }

  const labels = campanhas.slice(0, 10).map(c => (c.nome || '').slice(0, 20));
  const gastos = campanhas.slice(0, 10).map(c => c.gasto || 0);
  const leads = campanhas.slice(0, 10).map(c => c.leads || 0);

  gastoLeadsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Gasto (R$)', data: gastos, backgroundColor: 'var(--cor-cedtec)', yAxisID: 'y' },
        { label: 'Leads', data: leads, backgroundColor: 'var(--accent)', yAxisID: 'y1' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#9ca3af' } } },
      scales: {
        y: { beginAtZero: true, position: 'left', ticks: { color: '#6b7280', callback: v => fmtMoney(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y1: { beginAtZero: true, position: 'right', ticks: { color: '#6b7280' }, grid: { display: false } },
        x: { ticks: { color: '#6b7280', maxRotation: 45 }, grid: { display: false } }
      }
    }
  });
}

// ── SALDO META ──

function renderSaldoMeta() {
  const el = document.getElementById('cedtec-saldo-display');
  if (!el) return;

  const saldo = contaMeta?.saldo_atual || 0;
  const limite = contaMeta?.limite || 0;
  const mediaDiaria = contaMeta?.gasto_mes > 0 ? contaMeta.gasto_mes / new Date().getDate() : (contaMeta?.gasto_hoje || 0);
  const diasRestantes = mediaDiaria > 0 ? (saldo / mediaDiaria).toFixed(1) : '—';
  const pctUsado = limite > 0 ? ((contaMeta.gasto_mes || 0) / limite * 100).toFixed(0) : 0;

  el.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:32px;font-weight:700;">${fmtMoney(saldo)}</div>
      <div style="font-size:13px;color:var(--text-muted);">disponivel</div>
    </div>
    ${limite > 0 ? `<div class="progress" style="margin-bottom:12px;"><div class="progress-bar" style="width:${Math.min(pctUsado, 100)}%"></div></div>
    <div style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:16px;">${pctUsado}% do limite de ${fmtMoney(limite)}</div>` : ''}
    <div style="display:flex;justify-content:space-around;text-align:center;">
      <div><div style="font-size:18px;font-weight:600;">${fmtMoney(mediaDiaria)}</div><div style="font-size:12px;color:var(--text-muted);">media diaria</div></div>
      <div><div style="font-size:18px;font-weight:600;">${diasRestantes}</div><div style="font-size:12px;color:var(--text-muted);">dias restantes</div></div>
    </div>
  `;

  // Recargas
  const listEl = document.getElementById('cedtec-recargas-list');
  if (listEl) {
    if (recargas.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px 0;">Nenhuma recarga registrada</p>';
    } else {
      listEl.innerHTML = recargas.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">
          <div>
            <div style="font-size:14px;font-weight:500;">${fmtMoney(r.valor)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${fmtDate(r.data)}${r.notas ? ' — ' + esc(r.notas) : ''}</div>
          </div>
          <button class="btn-icon" style="color:var(--danger)" onclick="cedtecDeleteRecarga('${r.id}')" title="Excluir">&#x1F5D1;</button>
        </div>
      `).join('');
    }
  }
}

// ── CAMPANHAS ──

function renderCampanhas() {
  const tbody = document.getElementById('cedtec-camp-body');
  const table = document.getElementById('cedtec-camp-table');
  const empty = document.getElementById('cedtec-camp-empty');
  const syncInfo = document.getElementById('cedtec-sync-info');

  if (syncInfo && conexao?.last_sync_at) {
    syncInfo.textContent = `Ultima sync: ${fmtDate(conexao.last_sync_at)}`;
  }

  if (campanhas.length === 0) {
    if (table) table.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (table) table.style.display = '';
  if (empty) empty.style.display = 'none';

  const mediaCpl = campanhas.reduce((s, c) => s + (c.cpl || 0), 0) / campanhas.length;

  tbody.innerHTML = campanhas.map(c => {
    const cplAlto = isCplAlto(c.cpl);
    const statusBadge = c.status === 'ACTIVE' ? 'badge-status-concluida' : 'badge-status-pendente';
    return `<tr>
      <td>${esc(c.nome)}</td>
      <td>${esc(c.curso) || '—'}</td>
      <td><span class="badge ${statusBadge}">${c.status || '—'}</span></td>
      <td>${fmtMoney(c.gasto)}</td>
      <td>${c.leads || 0}</td>
      <td>${c.ctr ? c.ctr.toFixed(1) + '%' : '—'}</td>
      <td>${cplAlto ? `<span class="badge badge-prio-urgente">${fmtMoney(c.cpl)}</span>` : fmtMoney(c.cpl)}</td>
    </tr>`;
  }).join('');
}

// ── SYNC META ──

export async function syncMeta() {
  toast.show('Sincronizando Meta Ads...', 'info');
  try {
    const { data, error } = await supabase.functions.invoke('meta-sync');
    if (error) throw error;
    toast.show(`Sincronizado: ${data?.synced || 0} campanhas`, 'success');
    await loadCedtec();
  } catch (e) {
    console.error('Meta sync error:', e);
    toast.show('Erro ao sincronizar — verifique as credenciais', 'error');
  }
}

// ── RECARGAS ──

export function openRecarga() {
  modal.open('Registrar recarga', `
    <div class="form-group"><label class="form-label">Valor (R$) *</label><input type="number" class="input" id="recarga-valor" step="0.01" min="0"></div>
    <div class="form-group"><label class="form-label">Data *</label><input type="date" class="input" id="recarga-data" value="${new Date().toISOString().slice(0, 10)}"></div>
    <div class="form-group"><label class="form-label">Notas</label><input type="text" class="input" id="recarga-notas"></div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="cedtecSaveRecarga()">Salvar</button>
  `);
}

export async function saveRecarga() {
  const valor = parseFloat(document.getElementById('recarga-valor')?.value);
  const data = document.getElementById('recarga-data')?.value;
  if (!valor || !data) { toast.show('Preencha valor e data', 'error'); return; }

  try {
    const { error } = await supabase.from('cedtec_recargas').insert({ valor, data, notas: document.getElementById('recarga-notas')?.value || null });
    if (error) throw error;
    toast.show('Recarga registrada', 'success');
    modal.close();
    await loadCedtec();
  } catch (e) {
    toast.show('Erro ao salvar', 'error');
  }
}

export async function deleteRecarga(id) {
  if (!confirm('Excluir esta recarga?')) return;
  try {
    const { error } = await supabase.from('cedtec_recargas').delete().eq('id', id);
    if (error) throw error;
    toast.show('Recarga excluida', 'success');
    await loadCedtec();
  } catch (e) {
    toast.show('Erro ao excluir', 'error');
  }
}

// ── HELPERS ──

function isCplAlto(cpl) {
  if (!cpl || campanhas.length === 0) return false;
  const media = campanhas.reduce((s, c) => s + (c.cpl || 0), 0) / campanhas.length;
  return cpl > media * 1.5;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
