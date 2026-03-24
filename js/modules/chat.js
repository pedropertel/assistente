// ══════════════════════════════════════════
// CHAT — Agentes de IA com streaming
// ══════════════════════════════════════════

import { supabase } from '../core/supabase.js';
import * as store from '../core/store.js';
import * as modal from '../core/modal.js';
import * as toast from '../core/toast.js';

let currentAgente = null; // null = chat geral
let agentes = [];
let recognition = null;
let isRecording = false;

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

  // Preparar request
  const entidades = store.get('entidades') || [];
  const body = {
    message: text,
    agente_slug: slug,
    entidades,
  };

  if (currentAgente) {
    body.agente_persona = currentAgente.persona || '';
    body.agente_contexto = currentAgente.contexto || '';
    body.agente_memorias = currentAgente.memorias || '';
    body.agente_inteligencia = currentAgente.inteligencia || '';
  }

  // Buscar últimas 10 mensagens como histórico
  try {
    let hq = supabase.from('chat_mensagens').select('role, conteudo').order('created_at', { ascending: false }).limit(10);
    if (slug) hq = hq.eq('agente_slug', slug);
    else hq = hq.is('agente_slug', null);
    const { data: hist } = await hq;
    body.historico = (hist || []).reverse();
  } catch (e) {
    body.historico = [];
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

    // Tentar streaming
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let finalData = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.done) {
              finalData = parsed;
            } else if (parsed.token) {
              fullText += parsed.token;
              if (bubble) bubble.innerHTML = renderMarkdown(fullText);
              scrollToBottom();
            }
          } catch {}
        }
      }

      // Se não recebeu streaming, tentar como JSON direto
      if (!fullText && !finalData) {
        try {
          const text = decoder.decode();
          finalData = JSON.parse(chunk + text);
          fullText = finalData.reply || '';
        } catch {}
      }

      if (bubble) bubble.innerHTML = renderMarkdown(fullText || 'Sem resposta');

      // Processar action e memory_suggest
      if (finalData) {
        await processResponse(finalData, fullText, slug);
      }
    } else {
      // Fallback: resposta completa de uma vez
      const data = await response.json();
      if (bubble) bubble.innerHTML = renderMarkdown(data.reply || 'Sem resposta');
      await processResponse(data, data.reply, slug);
    }

    scrollToBottom();
  } catch (e) {
    console.error('Chat error:', e);
    const bubble = document.getElementById(bubbleId);
    if (bubble) bubble.innerHTML = `<span style="color:var(--danger);">Erro ao processar — verifique a Edge Function</span>`;
    toast.show('Erro na comunicacao com a IA', 'error');
  }
}

async function processResponse(data, replyText, slug) {
  // Salvar resposta no banco
  try {
    await supabase.from('chat_mensagens').insert({
      role: 'assistant',
      conteudo: replyText || data.reply || '',
      contexto: slug || 'geral',
      agente_slug: slug,
      acao_executada: data.action || null,
      acao_dados: data.actionData || null,
    });
  } catch (e) {
    console.error('Erro ao salvar resposta:', e);
  }

  // Executar action
  if (data.action && data.actionData) {
    await handleAction(data.action, data.actionData);
    appendActionChip(data.action, data.actionData);
  }

  // Memory suggest
  if (data.memory_suggest && slug) {
    showMemorySuggest(slug, data.memory_suggest);
  }
}

// ── ACTIONS ──

async function handleAction(action, actionData) {
  try {
    switch (action) {
      case 'tarefa':
        await supabase.from('tarefas').insert({
          titulo: actionData.titulo,
          descricao: actionData.descricao || null,
          entidade_id: actionData.entidade_id || null,
          prioridade: actionData.prioridade || 'media',
          data_vencimento: actionData.data_vencimento || null,
          lembrete_em: actionData.lembrete_em || null,
        });
        toast.show('Tarefa criada', 'success');
        break;

      case 'evento':
        await supabase.from('eventos').insert({
          titulo: actionData.titulo,
          data_inicio: actionData.data_inicio,
          data_fim: actionData.data_fim || null,
          local: actionData.local || null,
          entidade_id: actionData.entidade_id || null,
          dia_inteiro: actionData.dia_inteiro || false,
        });
        toast.show('Evento criado', 'success');
        break;

      case 'gasto':
        await supabase.from('sitio_lancamentos').insert({
          descricao: actionData.descricao,
          valor: actionData.valor,
          centro_custo_id: actionData.centro_custo_id || null,
          tipo: actionData.tipo || 'realizado',
          data_realizada: actionData.data_realizada || new Date().toISOString().slice(0, 10),
        });
        toast.show('Lancamento registrado', 'success');
        break;
    }
  } catch (e) {
    console.error('Action error:', e);
    toast.show('Erro ao executar acao', 'error');
  }
}

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

// ── HELPERS ──

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}
