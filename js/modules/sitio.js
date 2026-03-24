// ══════════════════════════════════════════
// SÍTIO — Controle financeiro
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';
import { fmtMoney, fmtDate } from '../core/utils.js';

let categorias = [];
let lancamentos = [];
let activeTab = 'visao';
let filterCentro = null;
let filterTipo = null;
let cronoChart = null;
let pizzaChart = null;

export async function loadSitio() {
  try {
    const [cats, lancs] = await Promise.all([
      supabase.from('sitio_categorias').select('*').order('ordem'),
      supabase.from('sitio_lancamentos').select('*').order('created_at', { ascending: false }),
    ]);
    categorias = cats.data || [];
    lancamentos = lancs.data || [];
  } catch (e) {
    console.error('Erro ao carregar sítio:', e);
  }
  renderTab();
}

// ── TABS ──

export function tab(t) {
  activeTab = t;
  document.querySelectorAll('#page-sitio .tab').forEach((el, i) => {
    el.classList.toggle('active', ['visao','lancamentos','centros','cronograma','relatorios'][i] === t);
  });
  ['visao','lancamentos','centros','cronograma','relatorios'].forEach(id => {
    const el = document.getElementById(`sitio-tab-${id}`);
    if (el) el.style.display = id === t ? '' : 'none';
  });
  renderTab();
}

function renderTab() {
  switch (activeTab) {
    case 'visao': renderVisaoGeral(); break;
    case 'lancamentos': renderLancamentos(); break;
    case 'centros': renderCentrosGrid(); break;
    case 'cronograma': renderCronograma(); break;
    case 'relatorios': renderRelatorios(); break;
  }
}

// ── VISÃO GERAL ──

function renderVisaoGeral() {
  const totalInvestido = lancamentos.filter(l => l.tipo === 'realizado').reduce((s, l) => s + Number(l.valor), 0);
  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const gastoMes = lancamentos.filter(l => l.tipo === 'realizado' && (l.data_realizada || '').startsWith(mesAtual)).reduce((s, l) => s + Number(l.valor), 0);
  const planejado3m = lancamentos.filter(l => l.tipo === 'planejado').reduce((s, l) => s + Number(l.valor), 0);

  const statsEl = document.getElementById('sitio-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x1F4B0;</span><span class="stat-card-label">Total investido</span></div><div class="stat-card-value">${fmtMoney(totalInvestido)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x1F4C5;</span><span class="stat-card-label">Gasto este mes</span></div><div class="stat-card-value">${fmtMoney(gastoMes)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x1F4CB;</span><span class="stat-card-label">Planejado</span></div><div class="stat-card-value">${fmtMoney(planejado3m)}</div></div>
      <div class="stat-card"><div class="stat-card-header"><span class="stat-card-icon">&#x1F3AF;</span><span class="stat-card-label">Centros ativos</span></div><div class="stat-card-value">${categorias.length}</div></div>
    `;
  }

  // Barras por centro
  const barrasEl = document.getElementById('sitio-barras');
  if (barrasEl) {
    const totais = {};
    lancamentos.filter(l => l.tipo === 'realizado').forEach(l => {
      totais[l.centro_custo_id] = (totais[l.centro_custo_id] || 0) + Number(l.valor);
    });
    const maxVal = Math.max(...Object.values(totais), 1);

    barrasEl.innerHTML = categorias.map(c => {
      const val = totais[c.id] || 0;
      const pct = totalInvestido > 0 ? ((val / totalInvestido) * 100).toFixed(0) : 0;
      const barW = maxVal > 0 ? ((val / maxVal) * 100).toFixed(0) : 0;
      return `<div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
          <span>${c.icone} ${esc(c.nome)}</span>
          <span>${fmtMoney(val)} &nbsp; ${pct}%</span>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${barW}%;background:${c.cor}"></div></div>
      </div>`;
    }).join('');
  }

  // Últimos 5
  const ultimosEl = document.getElementById('sitio-ultimos');
  if (ultimosEl) {
    const ult = lancamentos.slice(0, 5);
    if (ult.length === 0) {
      ultimosEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:16px 0;">Nenhum lancamento ainda</p>';
    } else {
      const catMap = {};
      categorias.forEach(c => catMap[c.id] = c);
      ultimosEl.innerHTML = ult.map(l => {
        const cat = catMap[l.centro_custo_id];
        const data = l.data_realizada || l.data_prevista || '';
        return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span>${data ? fmtDate(data) : '—'} &nbsp; ${esc(l.descricao)}</span>
          <span style="font-weight:600;white-space:nowrap;">${fmtMoney(l.valor)}</span>
        </div>`;
      }).join('');
    }
  }
}

// ── LANÇAMENTOS ──

function renderLancamentos() {
  const filtersEl = document.getElementById('sitio-lanc-filters');
  if (filtersEl) {
    filtersEl.innerHTML = `
      <select class="select" style="width:auto;min-height:36px;font-size:13px;" onchange="sitioFilterCentro(this.value)">
        <option value="">Todos centros</option>
        ${categorias.map(c => `<option value="${c.id}" ${filterCentro === c.id ? 'selected' : ''}>${c.icone} ${c.nome}</option>`).join('')}
      </select>
      <select class="select" style="width:auto;min-height:36px;font-size:13px;" onchange="sitioFilterTipo(this.value)">
        <option value="">Todos tipos</option>
        <option value="realizado" ${filterTipo === 'realizado' ? 'selected' : ''}>Realizado</option>
        <option value="planejado" ${filterTipo === 'planejado' ? 'selected' : ''}>Planejado</option>
      </select>
    `;
  }

  let filtered = lancamentos;
  if (filterCentro) filtered = filtered.filter(l => l.centro_custo_id === filterCentro);
  if (filterTipo) filtered = filtered.filter(l => l.tipo === filterTipo);

  const tbody = document.getElementById('sitio-lanc-body');
  const table = document.getElementById('sitio-lanc-table');
  const empty = document.getElementById('sitio-lanc-empty');

  if (filtered.length === 0) {
    if (table) table.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (table) table.style.display = '';
  if (empty) empty.style.display = 'none';

  const catMap = {};
  categorias.forEach(c => catMap[c.id] = c);

  tbody.innerHTML = filtered.map(l => {
    const cat = catMap[l.centro_custo_id];
    const data = l.data_realizada || l.data_prevista || '';
    const tipoClass = l.tipo === 'realizado' ? 'badge-status-concluida' : 'badge-prio-media';
    const attach = l.comprovante_url ? `<span style="cursor:pointer;" onclick="event.stopPropagation();sitioViewAttach('${l.comprovante_url}')">&#x1F4CE;</span>` : '';

    return `<tr>
      <td>${data ? fmtDate(data) : '—'}</td>
      <td>${esc(l.descricao)}</td>
      <td>${cat ? `<span style="color:${cat.cor}">${cat.icone}</span> ${cat.nome}` : '—'}</td>
      <td><span class="badge ${tipoClass}">${l.tipo}</span></td>
      <td style="font-weight:600;white-space:nowrap;">${fmtMoney(l.valor)}</td>
      <td>${attach}</td>
      <td>
        <button class="btn-icon" onclick="openEditLanc('${l.id}')" title="Editar">&#x270F;&#xFE0F;</button>
        <button class="btn-icon" style="color:var(--danger)" onclick="deleteLanc('${l.id}')" title="Excluir">&#x1F5D1;</button>
      </td>
    </tr>`;
  }).join('');
}

export function setFilterCentro(val) { filterCentro = val || null; renderLancamentos(); }
export function setFilterTipo(val) { filterTipo = val || null; renderLancamentos(); }

// ── CENTROS DE CUSTO ──

function renderCentrosGrid() {
  const grid = document.getElementById('sitio-centros-grid');
  if (!grid) return;

  const totais = {};
  lancamentos.filter(l => l.tipo === 'realizado').forEach(l => {
    totais[l.centro_custo_id] = (totais[l.centro_custo_id] || 0) + Number(l.valor);
  });

  grid.innerHTML = categorias.map(c => `
    <div class="card" style="text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">${c.icone}</div>
      <div style="font-size:14px;font-weight:600;color:${c.cor};margin-bottom:4px;">${esc(c.nome)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${c.tipo}</div>
      <div style="font-size:16px;font-weight:700;">${fmtMoney(totais[c.id] || 0)}</div>
      <div style="display:flex;gap:4px;justify-content:center;margin-top:8px;">
        <button class="btn-icon" onclick="openEditCentro('${c.id}')">&#x270F;&#xFE0F;</button>
        <button class="btn-icon" style="color:var(--danger)" onclick="deleteCentro('${c.id}')">&#x1F5D1;</button>
      </div>
    </div>
  `).join('');
}

// ── CRONOGRAMA ──

function renderCronograma() {
  const Chart = window.Chart;
  if (!Chart) return;

  const ctx = document.getElementById('sitio-chart-crono');
  if (!ctx) return;
  if (cronoChart) cronoChart.destroy();

  // Últimos 6 meses + próximos 3
  const labels = [];
  const realizados = [];
  const planejados = [];
  const now = new Date();

  for (let i = -6; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));

    const realSum = lancamentos.filter(l => l.tipo === 'realizado' && (l.data_realizada || '').startsWith(key)).reduce((s, l) => s + Number(l.valor), 0);
    const planSum = lancamentos.filter(l => l.tipo === 'planejado' && (l.data_prevista || '').startsWith(key)).reduce((s, l) => s + Number(l.valor), 0);
    realizados.push(realSum);
    planejados.push(planSum);
  }

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b6af0';

  cronoChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Realizado', data: realizados, backgroundColor: accent },
        { label: 'Planejado', data: planejados, backgroundColor: 'rgba(107,114,128,0.3)', borderColor: '#6b7280', borderWidth: 1, borderDash: [4, 4] },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#9ca3af' } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#6b7280', callback: v => fmtMoney(v) }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#6b7280' }, grid: { display: false } }
      }
    }
  });
}

// ── RELATÓRIOS ──

function renderRelatorios() {
  const Chart = window.Chart;

  // Pizza por centro
  if (Chart) {
    const ctx = document.getElementById('sitio-chart-pizza');
    if (ctx) {
      if (pizzaChart) pizzaChart.destroy();

      const totais = {};
      lancamentos.filter(l => l.tipo === 'realizado').forEach(l => {
        totais[l.centro_custo_id] = (totais[l.centro_custo_id] || 0) + Number(l.valor);
      });

      const labels = []; const values = []; const colors = [];
      categorias.forEach(c => {
        if (totais[c.id]) {
          labels.push(c.icone + ' ' + c.nome);
          values.push(totais[c.id]);
          colors.push(c.cor);
        }
      });

      const bgPrimary = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#0f1117';

      if (values.length > 0) {
        pizzaChart = new Chart(ctx, {
          type: 'doughnut',
          data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: bgPrimary, borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#9ca3af' } } } }
        });
      }
    }
  }

  // Resumo financeiro
  const resumoEl = document.getElementById('sitio-resumo-fin');
  if (resumoEl) {
    const totalReal = lancamentos.filter(l => l.tipo === 'realizado').reduce((s, l) => s + Number(l.valor), 0);
    const totalPlan = lancamentos.filter(l => l.tipo === 'planejado').reduce((s, l) => s + Number(l.valor), 0);
    const diff = totalReal - totalPlan;

    resumoEl.innerHTML = `
      <div class="card-title" style="margin-bottom:16px;">Resumo financeiro</div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);"><span>Total realizado</span><strong>${fmtMoney(totalReal)}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);"><span>Total planejado</span><strong>${fmtMoney(totalPlan)}</strong></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;"><span>Diferenca</span><strong style="color:${diff > 0 ? 'var(--danger)' : 'var(--success)'}">${fmtMoney(Math.abs(diff))} ${diff > 0 ? 'acima' : 'abaixo'}</strong></div>
    `;
  }
}

// ── CRUD LANÇAMENTOS ──

export function openNewLanc() {
  const catOptions = categorias.map(c => `<option value="${c.id}">${c.icone} ${c.nome}</option>`).join('');

  modal.open('Novo lancamento', `
    <div class="form-group"><label class="form-label">Descricao *</label><input type="text" class="input" id="lanc-desc" placeholder="O que foi pago?"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Valor (R$) *</label><input type="number" class="input" id="lanc-valor" step="0.01" min="0"></div>
      <div class="form-group"><label class="form-label">Centro de custo *</label><select class="select" id="lanc-centro"><option value="">Selecione</option>${catOptions}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Tipo *</label><select class="select" id="lanc-tipo" onchange="sitioToggleDatas()"><option value="realizado">Realizado</option><option value="planejado">Planejado</option></select></div>
      <div class="form-group" id="lanc-data-group"><label class="form-label">Data *</label><input type="date" class="input" id="lanc-data" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <div class="form-group"><label class="form-label">Notas</label><textarea class="textarea" id="lanc-notas" rows="2"></textarea></div>
    <div class="form-group"><label class="form-label">Comprovante</label><input type="file" class="input" id="lanc-comprovante" accept="image/*,application/pdf" capture="camera" style="padding:8px;"></div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="sitioSaveLanc()">Salvar</button>
  `);
}

export function openEditLanc(id) {
  const l = lancamentos.find(x => x.id === id);
  if (!l) return;
  openNewLanc();
  setTimeout(() => {
    const el = s => document.getElementById(s);
    if (el('lanc-desc')) el('lanc-desc').value = l.descricao || '';
    if (el('lanc-valor')) el('lanc-valor').value = l.valor || '';
    if (el('lanc-centro')) el('lanc-centro').value = l.centro_custo_id || '';
    if (el('lanc-tipo')) el('lanc-tipo').value = l.tipo || 'realizado';
    if (el('lanc-data')) el('lanc-data').value = l.data_realizada || l.data_prevista || '';
    if (el('lanc-notas')) el('lanc-notas').value = l.notas || '';

    const title = document.querySelector('.modal-title');
    if (title) title.textContent = 'Editar lancamento';
    const footer = document.getElementById('modal-footer');
    if (footer) footer.innerHTML = `
      <button class="btn btn-danger btn-sm" onclick="deleteLanc('${id}')">Excluir</button>
      <div style="flex:1"></div>
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="sitioSaveLanc('${id}')">Salvar</button>
    `;
  }, 10);
}

export async function saveLanc(id) {
  const desc = document.getElementById('lanc-desc')?.value.trim();
  const valor = parseFloat(document.getElementById('lanc-valor')?.value);
  const centro = document.getElementById('lanc-centro')?.value;
  const tipo = document.getElementById('lanc-tipo')?.value || 'realizado';
  const data = document.getElementById('lanc-data')?.value;

  if (!desc || !valor || !centro) {
    toast.show('Preencha descricao, valor e centro', 'error');
    return;
  }

  const row = {
    descricao: desc,
    valor,
    centro_custo_id: centro,
    tipo,
    data_realizada: tipo === 'realizado' ? data : null,
    data_prevista: tipo === 'planejado' ? data : null,
    notas: document.getElementById('lanc-notas')?.value || null,
  };

  // Upload comprovante
  const fileInput = document.getElementById('lanc-comprovante');
  if (fileInput?.files?.length > 0) {
    const file = fileInput.files[0];
    const path = `sitio/comprovantes/${Date.now()}_${file.name}`;
    try {
      const { error: upErr } = await supabase.storage.from('documentos').upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('documentos').getPublicUrl(path);
      row.comprovante_url = urlData?.publicUrl || path;
    } catch (e) {
      console.error('Upload comprovante:', e);
      toast.show('Erro no upload do comprovante', 'error');
    }
  }

  try {
    if (id) {
      const { error } = await supabase.from('sitio_lancamentos').update(row).eq('id', id);
      if (error) throw error;
      toast.show('Lancamento atualizado', 'success');
    } else {
      const { error } = await supabase.from('sitio_lancamentos').insert(row);
      if (error) throw error;
      toast.show('Lancamento registrado', 'success');
    }
    modal.close();
    await loadSitio();
  } catch (e) {
    console.error(e);
    toast.show('Erro ao salvar', 'error');
  }
}

export async function deleteLanc(id) {
  if (!confirm('Excluir este lancamento?')) return;
  try {
    const { error } = await supabase.from('sitio_lancamentos').delete().eq('id', id);
    if (error) throw error;
    toast.show('Lancamento excluido', 'success');
    modal.close();
    await loadSitio();
  } catch (e) {
    toast.show('Erro ao excluir', 'error');
  }
}

export function viewAttach(url) {
  if (!url) return;
  const tipo = url.match(/\.(pdf)$/i) ? 'application/pdf' : 'image/jpeg';
  // Reusa openFileViewer do window bridge se existir
  if (window.openFileViewer) window.openFileViewer(url, tipo);
  else window.open(url, '_blank');
}

export function toggleDatas() {
  const tipo = document.getElementById('lanc-tipo')?.value;
  const label = document.querySelector('#lanc-data-group .form-label');
  if (label) label.textContent = tipo === 'planejado' ? 'Data prevista *' : 'Data realizada *';
}

// ── CRUD CENTROS ──

export function openNewCentro() {
  modal.open('Novo centro de custo', `
    <div class="form-group"><label class="form-label">Nome *</label><input type="text" class="input" id="centro-nome"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Cor</label><input type="color" class="input" id="centro-cor" value="#4A9B5F" style="padding:4px;height:44px;"></div>
      <div class="form-group"><label class="form-label">Icone (emoji)</label><input type="text" class="input" id="centro-icone" value="&#x1F331;" maxlength="4"></div>
    </div>
    <div class="form-group"><label class="form-label">Tipo</label>
      <select class="select" id="centro-tipo"><option value="geral">Geral</option><option value="terreno">Terreno</option><option value="obra">Obra</option><option value="lavoura">Lavoura</option><option value="infra">Infra</option></select>
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="sitioSaveCentro()">Salvar</button>
  `);
}

export function openEditCentro(id) {
  const c = categorias.find(x => x.id === id);
  if (!c) return;
  openNewCentro();
  setTimeout(() => {
    const el = s => document.getElementById(s);
    if (el('centro-nome')) el('centro-nome').value = c.nome || '';
    if (el('centro-cor')) el('centro-cor').value = c.cor || '#4A9B5F';
    if (el('centro-icone')) el('centro-icone').value = c.icone || '';
    if (el('centro-tipo')) el('centro-tipo').value = c.tipo || 'geral';

    const title = document.querySelector('.modal-title');
    if (title) title.textContent = 'Editar centro de custo';
    const footer = document.getElementById('modal-footer');
    if (footer) footer.innerHTML = `
      <button class="btn btn-danger btn-sm" onclick="deleteCentro('${id}')">Excluir</button>
      <div style="flex:1"></div>
      <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="sitioSaveCentro('${id}')">Salvar</button>
    `;
  }, 10);
}

export async function saveCentro(id) {
  const nome = document.getElementById('centro-nome')?.value.trim();
  if (!nome) { toast.show('Nome obrigatorio', 'error'); return; }
  const row = {
    nome,
    cor: document.getElementById('centro-cor')?.value || '#4A9B5F',
    icone: document.getElementById('centro-icone')?.value || '',
    tipo: document.getElementById('centro-tipo')?.value || 'geral',
  };
  try {
    if (id) {
      const { error } = await supabase.from('sitio_categorias').update(row).eq('id', id);
      if (error) throw error;
      toast.show('Centro atualizado', 'success');
    } else {
      const { error } = await supabase.from('sitio_categorias').insert(row);
      if (error) throw error;
      toast.show('Centro criado', 'success');
    }
    modal.close();
    await loadSitio();
  } catch (e) {
    toast.show('Erro ao salvar', 'error');
  }
}

export async function deleteCentro(id) {
  const { count } = await supabase.from('sitio_lancamentos').select('id', { count: 'exact', head: true }).eq('centro_custo_id', id);
  if ((count || 0) > 0) {
    toast.show('Centro tem lancamentos — nao pode excluir', 'error');
    return;
  }
  if (!confirm('Excluir este centro?')) return;
  try {
    const { error } = await supabase.from('sitio_categorias').delete().eq('id', id);
    if (error) throw error;
    toast.show('Centro excluido', 'success');
    modal.close();
    await loadSitio();
  } catch (e) {
    toast.show('Erro ao excluir', 'error');
  }
}

// ── HELPERS ──

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
