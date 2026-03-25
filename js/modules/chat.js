// ══════════════════════════════════════════
// CHAT — Agentes de IA com streaming
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as toast from '../core/toast.js';

let currentAgente = null; // null = chat geral
let agentes = [];
let recognition = null;
let isRecording = false;
let pendingFiles = []; // [{name, type, content, isImage}]

// ── LOAD ──

export async function loadChat() {
  try {
    const { data } = await supabase.from('agentes').select('*').eq('ativo', true).order('ordem');
    agentes = data || [];
  } catch (e) {
    console.error('Erro ao carregar agentes:', e);
  }
  showAgentGrid();
}

// ── SELEÇÃO DE AGENTE ──

export function showAgentGrid() {
  const grid = document.getElementById('chat-agent-grid');
  const view = document.getElementById('chat-view');
  if (grid) grid.style.display = '';
  if (view) { view.style.display = 'none'; view.classList.remove('active'); }

  const container = document.getElementById('chat-agents');
  if (!container) return;

  container.innerHTML = agentes.map(a => {
    const foto = a.foto_url
      ? `<img src="${a.foto_url}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;">`
      : `<div style="width:48px;height:48px;border-radius:50%;background:${a.cor || 'var(--accent)'};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;">${(a.nome || '?')[0]}</div>`;

    return `
      <div class="chat-agent-card" onclick="selectAgente('${a.slug}')">
        <div style="display:flex;justify-content:center;margin-bottom:8px;">${foto}</div>
        <div style="font-weight:600;font-size:14px;">${esc(a.nome)}</div>
        <div style="font-size:12px;color:var(--text-muted);">${esc(a.descricao || '')}</div>
      </div>
    `;
  }).join('');
}

export async function selectAgente(slug) {
  currentAgente = slug ? agentes.find(a => a.slug === slug) : null;

  const grid = document.getElementById('chat-agent-grid');
  const view = document.getElementById('chat-view');
  if (grid) grid.style.display = 'none';
  if (view) { view.style.display = 'flex'; view.classList.add('active'); }

  // Header
  const avatar = document.getElementById('chat-agent-avatar');
  const nameEl = document.getElementById('chat-agent-name');
  const descEl = document.getElementById('chat-agent-desc');

  if (currentAgente) {
    if (avatar) {
      avatar.style.background = currentAgente.cor || 'var(--accent)';
      avatar.textContent = currentAgente.nome[0];
    }
    if (nameEl) nameEl.textContent = currentAgente.nome;
    if (descEl) descEl.textContent = currentAgente.descricao || '';
  } else {
    if (avatar) { avatar.style.background = 'var(--accent)'; avatar.textContent = 'A'; }
    if (nameEl) nameEl.textContent = 'Chat Geral';
    if (descEl) descEl.textContent = 'Assistente com dispatch automatico';
  }

  // Carregar histórico
  await loadHistory(slug);

  // Auto-briefing: se última mensagem > 1h ou sem histórico, pedir briefing
  if (slug) {
    try {
      const { data: lastMsg } = await supabase.from('chat_mensagens')
        .select('created_at')
        .eq('agente_slug', slug)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const isStale = !lastMsg || (Date.now() - new Date(lastMsg.created_at).getTime() > 3600000);
      if (isStale) {
        setTimeout(() => sendAutoMsg('Briefing rapido: o que preciso saber agora?'), 300);
      }
    } catch {
      // Sem histórico — enviar briefing
      setTimeout(() => sendAutoMsg('Briefing rapido: o que preciso saber agora?'), 300);
    }
  }

  // Focus no input
  document.getElementById('chat-input')?.focus();
}

// ── HISTÓRICO ──

async function loadHistory(slug) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = '';

  try {
    let q = supabase.from('chat_mensagens').select('*').order('created_at', { ascending: true }).limit(50);
    if (slug) q = q.eq('agente_slug', slug);
    else q = q.is('agente_slug', null);

    const { data } = await q;
    (data || []).forEach(msg => {
      appendMsg(msg.role, msg.conteudo, false);
      // Mostrar action chip se houver
      if (msg.acao_executada) {
        appendActionChip(msg.acao_executada, msg.acao_dados);
      }
    });
    scrollToBottom();
  } catch (e) {
    console.error('Erro ao carregar historico:', e);
  }
}

// ── ENVIO DE MENSAGEM ──

export async function sendMsg() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = '44px';

  // Mostrar balão do user
  appendMsg('user', text);

  // Salvar no banco
  const slug = currentAgente?.slug || null;
  try {
    await supabase.from('chat_mensagens').insert({
      role: 'user',
      conteudo: text,
      contexto: slug || 'geral',
      agente_slug: slug,
    });
  } catch (e) {
    console.error('Erro ao salvar msg:', e);
  }

  // Criar balão do agente vazio com cursor
  const bubbleId = 'bubble-' + Date.now();
  appendMsg('assistant', '<span class="chat-cursor"></span>', false, bubbleId);
  scrollToBottom();

  // Incluir arquivos de texto na mensagem
  let messageText = text;
  const textFiles = pendingFiles.filter(f => !f.isImage);
  if (textFiles.length > 0) {
    const filesBlock = textFiles.map(f => `[Arquivo: ${f.name}]\n${f.content}`).join('\n\n');
    messageText = `${text}\n\n${filesBlock}`;
  }

  // Guardar imagens para enviar separado
  const imageFiles = pendingFiles.filter(f => f.isImage);

  // Limpar attachments
  removeAttachment();

  // Preparar request — body mínimo, Edge Function carrega tudo server-side
  const body = {
    message: messageText,
    agente_slug: slug,
  };

  // Incluir imagens se anexadas
  if (imageFiles.length === 1) {
    body.image = imageFiles[0].content;
  } else if (imageFiles.length > 1) {
    body.images = imageFiles.map(f => f.content);
  }

  // Chamar Edge Function
  try {
    const response = await fetch(`https://msbwplsknncnxwsalumd.supabase.co/functions/v1/chat-claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const bubble = document.getElementById(bubbleId);

    // Resposta JSON direta
    const data = await response.json();
    const replyText = data.reply || 'Sem resposta';

    if (bubble) bubble.innerHTML = renderMarkdown(replyText);
    scrollToBottom();

    await processResponse(data, replyText, slug);
  } catch (e) {
    console.error('Chat error:', e);
    const bubble = document.getElementById(bubbleId);
    if (bubble) bubble.innerHTML = `<span style="color:var(--danger);">Erro ao processar — verifique a Edge Function</span>`;
    toast.show('Erro na comunicacao com a IA', 'error');
  }
}

async function processResponse(data, replyText, slug) {
  // Salvar resposta no banco
  const firstTool = data.tool_calls?.[0];
  try {
    await supabase.from('chat_mensagens').insert({
      role: 'assistant',
      conteudo: replyText || data.reply || '',
      contexto: slug || 'geral',
      agente_slug: slug,
      acao_executada: firstTool?.name || null,
      acao_dados: firstTool?.input || null,
    });
  } catch (e) {
    console.error('Erro ao salvar resposta:', e);
  }

  // Processar tool calls (v3 — tool_use nativo)
  if (data.tool_calls && data.tool_calls.length > 0) {
    for (const call of data.tool_calls) {
      await handleToolCall(call);
    }
  }
}

async function handleToolCall(call) {
  try {
    switch (call.name) {
      case 'criar_tarefa': {
        const d = call.input;
        await supabase.from('tarefas').insert({
          titulo: d.titulo,
          descricao: d.descricao || null,
          entidade_id: d.entidade_id || null,
          prioridade: d.prioridade || 'media',
          data_vencimento: d.data_vencimento || null,
        });
        toast.show('Tarefa criada: ' + d.titulo, 'success');
        appendActionChip('tarefa', d);
        break;
      }
      case 'criar_evento': {
        const d = call.input;
        await supabase.from('eventos').insert({
          titulo: d.titulo,
          data_inicio: d.data_inicio,
          data_fim: d.data_fim || null,
          local: d.local || null,
          entidade_id: d.entidade_id || null,
          dia_inteiro: d.dia_inteiro || false,
        });
        toast.show('Evento criado: ' + d.titulo, 'success');
        appendActionChip('evento', d);
        break;
      }
      case 'registrar_gasto': {
        const d = call.input;
        await supabase.from('sitio_lancamentos').insert({
          descricao: d.descricao,
          valor: d.valor,
          centro_custo_id: d.centro_custo_id || null,
          tipo: d.tipo || 'realizado',
          data_realizada: d.data_realizada || new Date().toISOString().slice(0, 10),
        });
        toast.show('Gasto registrado: ' + d.descricao, 'success');
        appendActionChip('gasto', d);
        break;
      }
      case 'sugerir_memoria': {
        const slug = currentAgente?.slug;
        if (slug && call.input.texto) {
          showMemorySuggest(slug, call.input.texto);
        }
        break;
      }
    }
  } catch (e) {
    console.error('Tool call error:', e);
    toast.show('Erro ao executar acao', 'error');
  }
}

// handleAction removido — substituído por handleToolCall (tool_use nativo)

function appendActionChip(action, data) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const labels = {
    tarefa: `Tarefa criada: ${data?.titulo || ''}`,
    evento: `Evento criado: ${data?.titulo || ''}`,
    gasto: `Lancamento: ${data?.descricao || ''}`,
  };
  const label = labels[action] || action;
  const chip = document.createElement('div');
  chip.className = 'chat-action-chip';
  chip.style.alignSelf = 'flex-start';
  chip.innerHTML = `&#x2705; ${esc(label)}`;
  container.appendChild(chip);
}

// ── MEMORY SUGGEST ──

function showMemorySuggest(slug, text) {
  const container = document.getElementById('chat-memory-suggest');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = `
    <div class="chat-memory-card">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">&#x1F4A1; Aprendi algo nessa conversa:</div>
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">"${esc(text)}"</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="saveMemoria('${slug}', '${esc(text).replace(/'/g, "\\'")}')">Salvar nas memorias</button>
        <button class="btn btn-ghost btn-sm" onclick="dismissMemoria()">Ignorar</button>
      </div>
    </div>
  `;
}

export async function saveMemoria(agenteSlug, texto) {
  try {
    const { data: ag } = await supabase.from('agentes').select('memorias').eq('slug', agenteSlug).single();
    if (!ag) return;
    const date = new Date().toISOString().slice(0, 10);
    const newMem = (ag.memorias || '') + `\n[${date}] ${texto}`;
    await supabase.from('agentes').update({ memorias: newMem.trim(), updated_at: new Date().toISOString() }).eq('slug', agenteSlug);
    toast.show('Memoria salva', 'success');

    // Atualizar agente local
    const local = agentes.find(a => a.slug === agenteSlug);
    if (local) local.memorias = newMem.trim();
  } catch (e) {
    toast.show('Erro ao salvar memoria', 'error');
  }
  dismissMemoria();
}

export function dismissMemoria() {
  const container = document.getElementById('chat-memory-suggest');
  if (container) { container.style.display = 'none'; container.innerHTML = ''; }
}

// ── ARQUIVO ANEXADO ──

export function attachFile() {
  const input = document.getElementById('chat-file-input');
  if (input) {
    input.onchange = async () => {
      const fileList = input.files;
      if (!fileList || fileList.length === 0) return;

      for (const file of fileList) {
        await processAttachment(file);
      }
      updateAttachmentPreview();
      input.value = '';
    };
    input.click();
  }
}

async function processAttachment(file) {
  if (file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataUrl(file);
    pendingFiles.push({ name: file.name, type: file.type, content: dataUrl, isImage: true });
  } else if (isExcelFile(file.name)) {
    try {
      const text = await readExcelAsText(file);
      pendingFiles.push({ name: file.name, type: file.type, content: text, isImage: false });
    } catch (e) {
      toast.show(`Erro ao ler ${file.name}`, 'error');
    }
  } else {
    try {
      const text = await file.text();
      pendingFiles.push({ name: file.name, type: file.type, content: text, isImage: false });
    } catch {
      toast.show(`Erro ao ler ${file.name}`, 'error');
    }
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateAttachmentPreview() {
  const preview = document.getElementById('chat-attachment');
  const nameEl = document.getElementById('chat-attachment-name');
  if (!preview || !nameEl) return;

  if (pendingFiles.length === 0) {
    preview.style.display = 'none';
    return;
  }

  const labels = pendingFiles.map(f => {
    if (f.isImage) return `🖼️ ${f.name}`;
    if (isExcelFile(f.name)) return `📊 ${f.name}`;
    return `📄 ${f.name}`;
  });

  nameEl.textContent = labels.join(', ');
  preview.style.display = 'flex';
}

function isExcelFile(name) {
  return /\.(xlsx|xls|xlsm)$/i.test(name);
}

async function readExcelAsText(file) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('SheetJS nao carregado');

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  let result = '';
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ' | ', blankrows: false });
    if (workbook.SheetNames.length > 1) {
      result += `\n=== Aba: ${sheetName} ===\n`;
    }
    result += csv + '\n';
  }
  return result.trim();
}

export function removeAttachment() {
  pendingFiles = [];
  const preview = document.getElementById('chat-attachment');
  if (preview) preview.style.display = 'none';
}

// ── VOZ ──

export function toggleMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast.show('Reconhecimento de voz nao suportado', 'error');
    return;
  }

  const btn = document.getElementById('chat-mic-btn');

  if (isRecording && recognition) {
    recognition.stop();
    isRecording = false;
    if (btn) btn.classList.remove('recording');
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.interimResults = true;
  recognition.continuous = false;

  const input = document.getElementById('chat-input');

  recognition.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = 0; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        final += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }
    if (input) {
      input.value = final || interim;
      if (interim && !final) input.style.fontStyle = 'italic';
      else input.style.fontStyle = '';
    }
  };

  recognition.onend = () => {
    isRecording = false;
    if (btn) btn.classList.remove('recording');
    if (input) input.style.fontStyle = '';
  };

  recognition.onerror = () => {
    isRecording = false;
    if (btn) btn.classList.remove('recording');
  };

  recognition.start();
  isRecording = true;
  if (btn) btn.classList.add('recording');
}

// ── RENDER ──

function appendMsg(role, content, save = false, bubbleId = null) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  const isUser = role === 'user';
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  let avatarHTML = '';
  if (!isUser) {
    const color = currentAgente?.cor || 'var(--accent)';
    const initial = currentAgente?.nome?.[0] || 'A';
    avatarHTML = `<div class="chat-avatar-sm" style="background:${color};">${initial}</div>`;
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (bubbleId) bubble.id = bubbleId;

  if (isUser) {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = content.includes('<') ? content : renderMarkdown(content);
  }

  if (!isUser) {
    const av = document.createElement('div');
    av.innerHTML = avatarHTML;
    msg.appendChild(av.firstElementChild);
  }
  msg.appendChild(bubble);
  container.appendChild(msg);
}

function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:var(--bg-tertiary);padding:1px 4px;border-radius:3px;">$1</code>')
    .replace(/\n/g, '<br>');
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) setTimeout(() => container.scrollTop = container.scrollHeight, 50);
}

async function sendAutoMsg(text) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    await sendMsg();
  }
}

export function keyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMsg();
  }
}

export function clearChat() {
  const container = document.getElementById('chat-messages');
  if (container) container.innerHTML = '';
}

export async function clearChatHistory() {
  if (!confirm('Limpar todo o historico desta conversa?')) return;
  const slug = currentAgente?.slug || null;
  try {
    let q = supabase.from('chat_mensagens').delete();
    if (slug) q = q.eq('agente_slug', slug);
    else q = q.is('agente_slug', null);
    await q;
    clearChat();
    toast.show('Historico limpo', 'success');
  } catch (e) {
    toast.show('Erro ao limpar', 'error');
  }
}

// ── HELPERS ──

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
