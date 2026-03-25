// ══════════════════════════════════════════
// CONFIGURAÇÕES — Agentes, integrações
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';
import { slugify } from '../core/utils.js';

let agentes = [];
let conexaoMeta = null;
let activeTab = 'agentes';

export async function loadConfig() {
  try {
    const [agRes, metaRes] = await Promise.all([
      supabase.from('agentes').select('*').order('ordem'),
      supabase.from('meta_conexoes').select('*').limit(1).single(),
    ]);
    agentes = agRes.data || [];
    conexaoMeta = metaRes.data;
  } catch (e) {
    console.error('Erro ao carregar config:', e);
  }
  renderTab();
}

// ── TABS ──

export function tab(t) {
  activeTab = t;
  const tabs = ['agentes', 'integracoes', 'aparencia', 'sobre'];
  document.querySelectorAll('#page-config .tab').forEach((el, i) => {
    el.classList.toggle('active', tabs[i] === t);
  });
  tabs.forEach(id => {
    const el = document.getElementById(`config-tab-${id}`);
    if (el) el.style.display = id === t ? '' : 'none';
  });
  renderTab();
}

function renderTab() {
  switch (activeTab) {
    case 'agentes': renderAgentes(); break;
    case 'integracoes': renderIntegracoes(); break;
    case 'aparencia': renderAparencia(); break;
  }
}

// ── AGENTES GRID ──

function renderAgentes() {
  const grid = document.getElementById('config-agentes-grid');
  const empty = document.getElementById('config-agentes-empty');
  if (!grid) return;

  if (agentes.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = agentes.map(a => {
    const foto = a.foto_url
      ? `<img src="${a.foto_url}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">`
      : `<div style="width:56px;height:56px;border-radius:50%;background:${a.cor || 'var(--accent)'};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;">${(a.nome || '?')[0]}</div>`;
    const statusDot = a.ativo
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);"></span> ativo'
      : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--text-muted);"></span> inativo';

    return `
      <div class="card" style="text-align:center;padding:20px 16px;">
        <div style="display:flex;justify-content:center;margin-bottom:12px;">${foto}</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:4px;">${esc(a.nome)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${esc(a.descricao || '')}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">${statusDot}</div>
        <button class="btn btn-secondary btn-sm" onclick="openEditAgente('${a.id}')">Editar</button>
      </div>
    `;
  }).join('');
}

// ── CRUD AGENTES ──

export function openNewAgente() {
  modal.open('Novo agente', buildAgenteForm(), `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="configSaveAgente()">Salvar</button>
  `);
}

export function openEditAgente(id) {
  const a = agentes.find(x => x.id === id);
  if (!a) return;
  editingAgenteId = id;

  modal.open('Editar agente', buildAgenteForm(), `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="configSaveAgente('${id}')">Salvar</button>
  `);

  setTimeout(() => {
    const el = s => document.getElementById(s);
    if (el('ag-nome')) el('ag-nome').value = a.nome || '';
    if (el('ag-slug')) el('ag-slug').value = a.slug || '';
    if (el('ag-descricao')) el('ag-descricao').value = a.descricao || '';
    if (el('ag-cor')) el('ag-cor').value = a.cor || '#5B6AF0';
    if (el('ag-ativo')) el('ag-ativo').checked = a.ativo !== false;
    if (el('ag-ordem')) el('ag-ordem').value = a.ordem || 0;
    if (el('ag-persona')) el('ag-persona').value = a.persona || '';
    if (el('ag-contexto')) el('ag-contexto').value = a.contexto || '';
    if (el('ag-memorias')) el('ag-memorias').value = a.memorias || '';
    if (el('ag-inteligencia')) el('ag-inteligencia').value = a.inteligencia || '';
    loadIntelFiles(a.slug);
  }, 10);
}

function buildAgenteForm() {
  return `
    <div class="tabs" style="margin-bottom:12px;">
      <button class="tab active" onclick="configAgTab('identidade')">Identidade</button>
      <button class="tab" onclick="configAgTab('persona')">Persona</button>
      <button class="tab" onclick="configAgTab('contexto')">Contexto</button>
      <button class="tab" onclick="configAgTab('memorias')">Memorias</button>
      <button class="tab" onclick="configAgTab('inteligencia')">Inteligencia</button>
    </div>

    <div id="ag-tab-identidade">
      <div class="form-group"><label class="form-label">Nome *</label><input type="text" class="input" id="ag-nome" oninput="configAutoSlug()"></div>
      <div class="form-group"><label class="form-label">Slug</label><input type="text" class="input" id="ag-slug" readonly style="color:var(--text-muted);"></div>
      <div class="form-group"><label class="form-label">Descricao</label><input type="text" class="input" id="ag-descricao" placeholder="Papel em uma linha"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group"><label class="form-label">Cor</label><input type="color" class="input" id="ag-cor" value="#5B6AF0" style="padding:4px;height:44px;"></div>
        <div class="form-group"><label class="form-label">Ordem</label><input type="number" class="input" id="ag-ordem" value="0" min="0"></div>
      </div>
      <div class="form-group">
        <label class="toggle" style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="ag-ativo" checked>
          <span class="toggle-track"></span>
          <span class="toggle-thumb"></span>
          <span style="font-size:13px;">Ativo</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-label">Foto</label>
        <input type="file" class="input" id="ag-foto" accept="image/*" style="padding:8px;">
      </div>
    </div>

    <div id="ag-tab-persona" style="display:none;">
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Quem e esse agente? Personalidade, tom de voz, o que faz bem e o que nunca faz.</p>
      <textarea class="textarea" id="ag-persona" rows="12" placeholder="Descreva a personalidade do agente..."></textarea>
    </div>

    <div id="ag-tab-contexto" style="display:none;">
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Dados do negocio que ele sempre carrega. Atualizado automaticamente + voce complementa.</p>
      <textarea class="textarea" id="ag-contexto" rows="12" placeholder="Dados atuais do negocio..."></textarea>
    </div>

    <div id="ag-tab-memorias" style="display:none;">
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Memorias acumuladas. Formato: [data] texto</p>
      <textarea class="textarea" id="ag-memorias" rows="12" placeholder="[2026-03-24] Pedro prefere..."></textarea>
    </div>

    <div id="ag-tab-inteligencia" style="display:none;">
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Base de conhecimento especializado. Texto + arquivos que o agente consulta em toda conversa.</p>
      <textarea class="textarea" id="ag-inteligencia" rows="8" placeholder="Benchmarks, historico, estrategia..."></textarea>
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Arquivos de referencia</span>
          <button class="btn btn-secondary btn-sm" onclick="configUploadIntelFile()">+ Arquivo</button>
        </div>
        <div id="ag-intel-files" style="font-size:13px;color:var(--text-muted);">Carregando...</div>
      </div>
    </div>
  `;
}

export function agTab(t) {
  ['identidade', 'persona', 'contexto', 'memorias', 'inteligencia'].forEach(id => {
    const el = document.getElementById(`ag-tab-${id}`);
    if (el) el.style.display = id === t ? '' : 'none';
  });
  // Atualizar tabs visuais dentro do modal
  const tabs = document.querySelectorAll('.modal-body .tab');
  const idx = ['identidade', 'persona', 'contexto', 'memorias', 'inteligencia'].indexOf(t);
  tabs.forEach((el, i) => el.classList.toggle('active', i === idx));
}

export function autoSlug() {
  const nome = document.getElementById('ag-nome')?.value || '';
  const slugEl = document.getElementById('ag-slug');
  if (slugEl) slugEl.value = slugify(nome);
}

export async function saveAgente(id) {
  const nome = document.getElementById('ag-nome')?.value.trim();
  if (!nome) { toast.show('Nome obrigatorio', 'error'); return; }

  const slug = document.getElementById('ag-slug')?.value || slugify(nome);
  const row = {
    nome,
    slug,
    descricao: document.getElementById('ag-descricao')?.value || null,
    cor: document.getElementById('ag-cor')?.value || '#5B6AF0',
    ativo: document.getElementById('ag-ativo')?.checked ?? true,
    ordem: parseInt(document.getElementById('ag-ordem')?.value) || 0,
    persona: document.getElementById('ag-persona')?.value || '',
    contexto: document.getElementById('ag-contexto')?.value || '',
    memorias: document.getElementById('ag-memorias')?.value || '',
    inteligencia: document.getElementById('ag-inteligencia')?.value || '',
    updated_at: new Date().toISOString(),
  };

  try {
    // Upload foto
    const fotoInput = document.getElementById('ag-foto');
    if (fotoInput?.files?.length > 0) {
      const file = fotoInput.files[0];
      const path = `${slug}/foto.${file.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from('agentes').upload(path, file, { upsert: true });
      if (!upErr) {
        const { data: urlData } = supabase.storage.from('agentes').getPublicUrl(path);
        row.foto_url = urlData?.publicUrl || null;
      }
    }

    if (id) {
      const { error } = await supabase.from('agentes').update(row).eq('id', id);
      if (error) throw error;
      toast.show('Agente atualizado', 'success');
    } else {
      const { error } = await supabase.from('agentes').insert(row);
      if (error) throw error;
      toast.show('Agente criado', 'success');
    }
    modal.close();
    await loadConfig();
  } catch (e) {
    console.error(e);
    toast.show('Erro ao salvar agente', 'error');
  }
}

export async function toggleAgente(id, ativo) {
  try {
    const { error } = await supabase.from('agentes').update({ ativo, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await loadConfig();
  } catch (e) {
    toast.show('Erro ao alterar status', 'error');
  }
}

export async function uploadAgentePhoto(id) {
  const a = agentes.find(x => x.id === id);
  if (!a) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const path = `${a.slug}/foto.${file.name.split('.').pop()}`;
    try {
      const { error: upErr } = await supabase.storage.from('agentes').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('agentes').getPublicUrl(path);
      await supabase.from('agentes').update({ foto_url: urlData?.publicUrl, updated_at: new Date().toISOString() }).eq('id', id);
      toast.show('Foto atualizada', 'success');
      await loadConfig();
    } catch (e) {
      toast.show('Erro no upload', 'error');
    }
  };
  input.click();
}

export async function uploadAgenteFile(id) {
  const a = agentes.find(x => x.id === id);
  if (!a) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.xlsx,.xls,.csv,.txt';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const path = `${a.slug}/files/${file.name}`;
    try {
      const { error: upErr } = await supabase.storage.from('agentes').upload(path, file);
      if (upErr) throw upErr;
      const ref = `\n[Arquivo: ${file.name} — ${new Date().toLocaleDateString('pt-BR')}]`;
      const newInteligencia = (a.inteligencia || '') + ref;
      await supabase.from('agentes').update({ inteligencia: newInteligencia, updated_at: new Date().toISOString() }).eq('id', id);
      toast.show('Arquivo enviado', 'success');
      await loadConfig();
    } catch (e) {
      toast.show('Erro no upload', 'error');
    }
  };
  input.click();
}

export async function deleteMemoria(id, idx) {
  const a = agentes.find(x => x.id === id);
  if (!a) return;
  const lines = (a.memorias || '').split('\n').filter(Boolean);
  lines.splice(idx, 1);
  try {
    await supabase.from('agentes').update({ memorias: lines.join('\n'), updated_at: new Date().toISOString() }).eq('id', id);
    toast.show('Memoria removida', 'success');
    await loadConfig();
  } catch (e) {
    toast.show('Erro ao remover', 'error');
  }
}

// ── ARQUIVOS DE INTELIGÊNCIA ──

let editingAgenteId = null;

export async function loadIntelFiles(agenteSlug) {
  const container = document.getElementById('ag-intel-files');
  if (!container) return;
  try {
    const { data } = await supabase.from('agente_arquivos').select('*').eq('agente_slug', agenteSlug).order('created_at', { ascending: false });
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Nenhum arquivo ainda</p>';
      return;
    }
    container.innerHTML = data.map(f => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span>${fileTypeIcon(f.arquivo_tipo)}</span>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(f.nome)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${f.conteudo_texto ? (f.conteudo_texto.length > 50 ? f.conteudo_texto.slice(0, 50) + '...' : f.conteudo_texto) : 'Arquivo binario'}</div>
          </div>
        </div>
        <button class="btn-icon" style="color:var(--danger);flex-shrink:0;" onclick="configDeleteIntelFile('${f.id}')" title="Excluir">&#x1F5D1;</button>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<p style="color:var(--danger);font-size:12px;">Erro ao carregar</p>';
  }
}

export async function uploadIntelFile() {
  if (!editingAgenteId) return;
  const a = agentes.find(x => x.id === editingAgenteId);
  if (!a) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.txt,.csv,.md,.json,.xlsx,.xls,.doc,.docx';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    toast.show(`Enviando ${file.name}...`, 'info');

    const path = `${a.slug}/intel/${Date.now()}_${file.name}`;
    try {
      const { error: upErr } = await supabase.storage.from('agentes').upload(path, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('agentes').getPublicUrl(path);

      // Extrair texto se possivel
      let conteudoTexto = null;
      if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.csv') || file.name.endsWith('.json')) {
        conteudoTexto = await file.text();
      }

      await supabase.from('agente_arquivos').insert({
        agente_slug: a.slug,
        nome: file.name,
        arquivo_url: urlData?.publicUrl || path,
        conteudo_texto: conteudoTexto,
        arquivo_tipo: file.type || 'application/octet-stream',
        arquivo_size: file.size,
      });

      toast.show('Arquivo adicionado a inteligencia', 'success');
      await loadIntelFiles(a.slug);
    } catch (e) {
      console.error(e);
      toast.show('Erro no upload', 'error');
    }
  };
  input.click();
}

export async function deleteIntelFile(id) {
  if (!confirm('Excluir este arquivo da inteligencia?')) return;
  try {
    const { data: f } = await supabase.from('agente_arquivos').select('arquivo_url').eq('id', id).single();
    if (f?.arquivo_url) {
      const path = f.arquivo_url.split('/storage/v1/object/public/agentes/')[1];
      if (path) await supabase.storage.from('agentes').remove([path]);
    }
    await supabase.from('agente_arquivos').delete().eq('id', id);
    toast.show('Arquivo removido', 'success');
    const a = agentes.find(x => x.id === editingAgenteId);
    if (a) await loadIntelFiles(a.slug);
  } catch (e) {
    toast.show('Erro ao excluir', 'error');
  }
}

function fileTypeIcon(mime) {
  if (!mime) return '&#x1F4C4;';
  if (mime.includes('pdf')) return '&#x1F4D1;';
  if (mime.includes('text') || mime.includes('csv') || mime.includes('json')) return '&#x1F4DD;';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '&#x1F4CA;';
  return '&#x1F4C4;';
}

// ── INTEGRAÇÕES ──

function renderIntegracoes() {
  const statusEl = document.getElementById('config-meta-status');
  const accountEl = document.getElementById('config-meta-account');
  const tokenEl = document.getElementById('config-meta-token');

  if (conexaoMeta) {
    if (statusEl) {
      const s = conexaoMeta.status || 'desconectado';
      const cls = s === 'conectado' ? 'badge-status-concluida' : s === 'configurado' ? 'badge-prio-media' : 'badge-status-pendente';
      statusEl.className = `badge ${cls}`;
      statusEl.textContent = s;
    }
    if (accountEl) accountEl.value = conexaoMeta.ad_account_id || '';
    if (tokenEl) tokenEl.value = conexaoMeta.access_token || '';
  }
}

export async function testMeta() {
  toast.show('Testando conexao...', 'info');
  try {
    const { data, error } = await supabase.functions.invoke('meta-balance');
    if (error) throw error;
    toast.show(`Conexao OK — Saldo: ${data?.balance ? 'R$ ' + data.balance : 'verificado'}`, 'success');
  } catch (e) {
    toast.show('Falha na conexao — verifique as credenciais', 'error');
  }
}

export async function saveMeta() {
  const account = document.getElementById('config-meta-account')?.value.trim();
  const token = document.getElementById('config-meta-token')?.value.trim();
  if (!account || !token) { toast.show('Preencha Account ID e Token', 'error'); return; }

  try {
    if (conexaoMeta?.id) {
      const { error } = await supabase.from('meta_conexoes').update({
        ad_account_id: account,
        access_token: token,
        status: 'configurado',
        updated_at: new Date().toISOString(),
      }).eq('id', conexaoMeta.id);
      if (error) throw error;
    }
    toast.show('Credenciais salvas', 'success');
    await loadConfig();
  } catch (e) {
    toast.show('Erro ao salvar', 'error');
  }
}

// ── APARÊNCIA ──

function renderAparencia() {
  const toggle = document.getElementById('config-theme-toggle');
  if (toggle) toggle.checked = document.documentElement.classList.contains('light');
}

// ── HELPERS ──

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
