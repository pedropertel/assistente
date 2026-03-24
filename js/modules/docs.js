// ══════════════════════════════════════════
// DOCUMENTOS — Pastas, upload, visualizador
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';

let currentFolderId = null; // null = raiz
let folders = [];
let files = [];
let breadcrumbPath = []; // [{id, nome}]

export async function loadDocs() {
  await navigateFolder(null);
  setupDragDrop();
}

// ── NAVEGAÇÃO ──

export async function navigateFolder(folderId) {
  currentFolderId = folderId;
  await Promise.all([loadFolders(), loadFiles()]);
  await buildBreadcrumb(folderId);
  renderDocs();
}

async function loadFolders() {
  try {
    let q = supabase.from('pastas').select('*').order('nome');
    if (currentFolderId) q = q.eq('pasta_pai_id', currentFolderId);
    else q = q.is('pasta_pai_id', null);
    const { data, error } = await q;
    if (error) throw error;
    folders = data || [];
  } catch (e) {
    console.error('Erro ao carregar pastas:', e);
    folders = [];
  }
}

async function loadFiles() {
  try {
    let q = supabase.from('documentos').select('*').order('created_at', { ascending: false });
    if (currentFolderId) q = q.eq('pasta_id', currentFolderId);
    else q = q.is('pasta_id', null);
    const { data, error } = await q;
    if (error) throw error;
    files = data || [];
  } catch (e) {
    console.error('Erro ao carregar arquivos:', e);
    files = [];
  }
}

async function buildBreadcrumb(folderId) {
  breadcrumbPath = [];
  let id = folderId;
  while (id) {
    try {
      const { data } = await supabase.from('pastas').select('id, nome, pasta_pai_id').eq('id', id).single();
      if (!data) break;
      breadcrumbPath.unshift({ id: data.id, nome: data.nome });
      id = data.pasta_pai_id;
    } catch { break; }
  }

  const el = document.getElementById('docs-breadcrumb');
  if (!el) return;

  let html = `<span style="cursor:pointer;" onclick="navigateFolder(null)">&#x1F4C1; Documentos</span>`;
  breadcrumbPath.forEach(p => {
    html += ` <span style="color:var(--text-muted);">/</span> <span style="cursor:pointer;" onclick="navigateFolder('${p.id}')">${esc(p.nome)}</span>`;
  });
  el.innerHTML = html;
}

// ── RENDER ──

function renderDocs() {
  const grid = document.getElementById('docs-grid');
  const empty = document.getElementById('docs-empty');
  if (!grid) return;

  if (folders.length === 0 && files.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  let html = '';

  // Pastas
  folders.forEach(f => {
    html += `
      <div class="doc-item" onclick="navigateFolder('${f.id}')">
        <div class="doc-item-icon">&#x1F4C1;</div>
        <div class="doc-item-name">${esc(f.nome)}</div>
        <div class="doc-item-menu">
          <button class="btn-icon" onclick="event.stopPropagation();docsContextFolder('${f.id}',event)" title="Opcoes">&#x22EE;</button>
        </div>
      </div>
    `;
  });

  // Arquivos
  files.forEach(f => {
    const icon = fileIcon(f.arquivo_tipo);
    const size = f.arquivo_size ? formatSize(f.arquivo_size) : '';
    html += `
      <div class="doc-item" onclick="openFileViewer('${f.arquivo_url || ''}','${f.arquivo_tipo || ''}')">
        <div class="doc-item-icon">${icon}</div>
        <div class="doc-item-name">${esc(f.nome || f.arquivo_nome)}</div>
        ${size ? `<div class="doc-item-size">${size}</div>` : ''}
        <div class="doc-item-menu">
          <button class="btn-icon" onclick="event.stopPropagation();docsContextFile('${f.id}',event)" title="Opcoes">&#x22EE;</button>
        </div>
      </div>
    `;
  });

  grid.innerHTML = html;
}

// ── CONTEXT MENUS ──

export function contextFolder(id, e) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'doc-context-menu';
  menu.id = 'docs-ctx';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.innerHTML = `
    <button onclick="docsRenameFolder('${id}')">&#x270F;&#xFE0F; Renomear</button>
    <button onclick="docsDeleteFolder('${id}')" style="color:var(--danger)">&#x1F5D1; Excluir</button>
  `;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
}

export function contextFile(id, e) {
  closeContextMenu();
  const f = files.find(x => x.id === id);
  if (!f) return;
  const menu = document.createElement('div');
  menu.className = 'doc-context-menu';
  menu.id = 'docs-ctx';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.innerHTML = `
    <button onclick="openFileViewer('${f.arquivo_url || ''}','${f.arquivo_tipo || ''}')">&#x1F441; Visualizar</button>
    <button onclick="downloadDoc('${id}')">&#x2B07; Download</button>
    <button onclick="shareDoc('${id}')">&#x1F517; Compartilhar</button>
    <button onclick="docsDeleteFile('${id}')" style="color:var(--danger)">&#x1F5D1; Excluir</button>
  `;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
  const m = document.getElementById('docs-ctx');
  if (m) m.remove();
}

// ── CRUD PASTAS ──

export function openNewFolder() {
  modal.open('Nova pasta', `
    <div class="form-group">
      <label class="form-label">Nome da pasta</label>
      <input type="text" class="input" id="folder-name" placeholder="Nome">
    </div>
  `, `
    <button class="btn btn-secondary" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="docsSaveFolder()">Criar</button>
  `);
}

export async function saveFolder() {
  const nome = document.getElementById('folder-name')?.value.trim();
  if (!nome) { toast.show('Nome obrigatorio', 'error'); return; }
  try {
    const { error } = await supabase.from('pastas').insert({
      nome,
      pasta_pai_id: currentFolderId,
    });
    if (error) throw error;
    toast.show('Pasta criada', 'success');
    modal.close();
    await navigateFolder(currentFolderId);
  } catch (e) {
    console.error(e);
    toast.show('Erro ao criar pasta', 'error');
  }
}

export async function renameFolder(id) {
  closeContextMenu();
  const folder = folders.find(f => f.id === id);
  if (!folder) return;
  const nome = prompt('Novo nome:', folder.nome);
  if (!nome || nome === folder.nome) return;
  try {
    const { error } = await supabase.from('pastas').update({ nome }).eq('id', id);
    if (error) throw error;
    toast.show('Pasta renomeada', 'success');
    await navigateFolder(currentFolderId);
  } catch (e) {
    toast.show('Erro ao renomear', 'error');
  }
}

export async function deleteFolder(id) {
  closeContextMenu();
  // Checar se está vazia
  const { count: subFolders } = await supabase.from('pastas').select('id', { count: 'exact', head: true }).eq('pasta_pai_id', id);
  const { count: subFiles } = await supabase.from('documentos').select('id', { count: 'exact', head: true }).eq('pasta_id', id);
  if ((subFolders || 0) > 0 || (subFiles || 0) > 0) {
    toast.show('Pasta nao esta vazia', 'error');
    return;
  }
  if (!confirm('Excluir esta pasta?')) return;
  try {
    const { error } = await supabase.from('pastas').delete().eq('id', id);
    if (error) throw error;
    toast.show('Pasta excluida', 'success');
    await navigateFolder(currentFolderId);
  } catch (e) {
    toast.show('Erro ao excluir', 'error');
  }
}

// ── UPLOAD ──

export function triggerUpload() {
  document.getElementById('docs-file-input')?.click();
}

export async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const progressEl = document.getElementById('docs-upload-progress');
  if (progressEl) progressEl.style.display = 'block';

  for (const file of fileList) {
    const path = `${currentFolderId || 'root'}/${Date.now()}_${file.name}`;
    try {
      if (progressEl) progressEl.innerHTML = `<div style="font-size:13px;color:var(--text-secondary);">Enviando ${esc(file.name)}...</div><div class="progress" style="margin-top:4px;"><div class="progress-bar" style="width:50%"></div></div>`;

      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('documentos').getPublicUrl(path);

      const { error: dbError } = await supabase.from('documentos').insert({
        nome: file.name,
        pasta_id: currentFolderId,
        arquivo_url: urlData?.publicUrl || path,
        arquivo_nome: file.name,
        arquivo_tipo: file.type,
        arquivo_size: file.size,
      });
      if (dbError) throw dbError;

      if (progressEl) progressEl.innerHTML = `<div style="font-size:13px;color:var(--success);">&#x2713; ${esc(file.name)} enviado</div>`;
    } catch (e) {
      console.error('Upload error:', e);
      toast.show(`Erro ao enviar ${file.name}`, 'error');
    }
  }

  setTimeout(() => { if (progressEl) progressEl.style.display = 'none'; }, 2000);

  // Reset input
  const input = document.getElementById('docs-file-input');
  if (input) input.value = '';

  await navigateFolder(currentFolderId);
}

// ── DRAG & DROP UPLOAD ──

function setupDragDrop() {
  const page = document.getElementById('page-docs');
  const dropzone = document.getElementById('docs-dropzone');
  if (!page || !dropzone) return;

  page.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.style.display = 'block'; });
  page.addEventListener('dragleave', (e) => {
    if (!page.contains(e.relatedTarget)) dropzone.style.display = 'none';
  });
  page.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.display = 'none';
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  });
}

// ── VISUALIZADOR ──

export function openFileViewer(url, tipo) {
  if (!url) { toast.show('Arquivo sem URL', 'error'); return; }

  let body;
  if (tipo && tipo.startsWith('image/')) {
    body = `<div style="text-align:center;"><img src="${url}" style="max-width:100%;max-height:70vh;border-radius:var(--radius-sm);"></div>`;
  } else if (tipo === 'application/pdf') {
    body = `<iframe src="${url}" style="width:100%;height:70vh;border:none;border-radius:var(--radius-sm);"></iframe>`;
  } else {
    body = `<div class="empty-state"><p class="empty-state-text">Pre-visualizacao nao disponivel</p><a href="${url}" target="_blank" class="btn btn-primary">Abrir / Baixar</a></div>`;
  }

  modal.open('Visualizador', body, `<a href="${url}" target="_blank" class="btn btn-secondary btn-sm">Abrir em nova aba</a> <button class="btn btn-secondary btn-sm" onclick="closeModal()">Fechar</button>`);
}

// ── DOWNLOAD ──

export async function downloadDoc(id) {
  closeContextMenu();
  const f = files.find(x => x.id === id);
  if (!f || !f.arquivo_url) return;
  const a = document.createElement('a');
  a.href = f.arquivo_url;
  a.download = f.arquivo_nome || f.nome;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── COMPARTILHAR ──

export async function shareDoc(id) {
  closeContextMenu();
  const f = files.find(x => x.id === id);
  if (!f || !f.arquivo_url) return;

  const url = f.arquivo_url;

  if (navigator.share) {
    try {
      await navigator.share({ title: f.nome, url });
    } catch { /* user cancelled */ }
  } else {
    try {
      await navigator.clipboard.writeText(url);
      toast.show('Link copiado', 'success');
    } catch {
      toast.show('Nao foi possivel copiar', 'error');
    }
  }
}

// ── EXCLUIR ARQUIVO ──

export async function deleteDoc(id) {
  closeContextMenu();
  if (!confirm('Excluir este arquivo?')) return;
  const f = files.find(x => x.id === id);
  try {
    // Remover do Storage
    if (f?.arquivo_url) {
      const path = f.arquivo_url.split('/storage/v1/object/public/documentos/')[1];
      if (path) await supabase.storage.from('documentos').remove([path]);
    }
    const { error } = await supabase.from('documentos').delete().eq('id', id);
    if (error) throw error;
    toast.show('Arquivo excluido', 'success');
    await navigateFolder(currentFolderId);
  } catch (e) {
    console.error(e);
    toast.show('Erro ao excluir', 'error');
  }
}

// ── HELPERS ──

function fileIcon(mime) {
  if (!mime) return '&#x1F4C4;';
  if (mime.startsWith('image/')) return '&#x1F5BC;';
  if (mime === 'application/pdf') return '&#x1F4D1;';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '&#x1F4CA;';
  if (mime.includes('word') || mime.includes('document')) return '&#x1F4DD;';
  return '&#x1F4C4;';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
