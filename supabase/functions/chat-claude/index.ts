// ══════════════════════════════════════════
// EDGE FUNCTION: chat-claude v2
// Smart Orchestrator — consulta DB, injeta dados reais, responde
// Modelo: claude-haiku-4-5-20251001
// ══════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN_LIMITS: Record<string, number> = {
  marcos: 3072,
  marcela: 2048,
  alemao: 2048,
  bruno: 2048,
  default: 2048,
};

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function trim(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n... (truncado)";
}

function fmtMoney(v: number): string {
  return `R$ ${(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

// ══════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ reply: "ANTHROPIC_API_KEY nao configurada." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { message, image, images, agente_slug } = body;

    const sb = getSupabase();

    // Hora de Brasília
    const now = new Date();
    const brTime = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const brDate = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const todayISO = now.toISOString().slice(0, 10);

    // Carregar entidades (sempre)
    const { data: entidades } = await sb.from("entidades").select("id, nome, tipo, icone").order("ordem");
    const entList = (entidades || []).map((e: any) => `${e.icone} ${e.nome} (id: ${e.id})`).join("\n");

    // Carregar histórico server-side (20 mensagens)
    const history = await loadHistory(sb, agente_slug, 20);

    let systemPrompt: string;
    let maxTokens: number;

    if (agente_slug) {
      // ── MODO AGENTE ──
      const agente = await loadAgente(sb, agente_slug);
      const agenteFiles = await loadAgenteFiles(sb, agente_slug);
      const liveData = await loadLiveData(sb, agente_slug, todayISO, entidades || []);

      systemPrompt = buildAgentePrompt(agente, liveData, agenteFiles, entList, brDate, brTime);
      maxTokens = TOKEN_LIMITS[agente_slug] || TOKEN_LIMITS.default;
    } else {
      // ── MODO DISPATCH (1 chamada, sem classifyDomain) ──
      const summaryData = await loadDispatchSummary(sb, todayISO);
      systemPrompt = buildDispatchPrompt(summaryData, entList, brDate, brTime);
      maxTokens = TOKEN_LIMITS.default;
    }

    // Montar messages
    const messages: any[] = [];
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }

    // Mensagem do usuário (com imagens se houver)
    const allImages = images || (image ? [image] : []);
    const imageBlocks: any[] = [];
    for (const img of allImages) {
      if (typeof img === "string" && img.startsWith("data:image/")) {
        const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          imageBlocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
        }
      }
    }

    if (imageBlocks.length > 0) {
      messages.push({ role: "user", content: [...imageBlocks, { type: "text", text: message }] });
    } else {
      messages.push({ role: "user", content: message });
    }

    // Chamar Anthropic API com streaming
    const anthropicResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages, stream: true }),
    });

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      console.error("Anthropic error:", err);
      return new Response(JSON.stringify({ reply: "Erro na API da IA. Tente novamente." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream SSE
    const reader = anthropicResp.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let doneSent = false;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                  fullText += parsed.delta.text;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: parsed.delta.text })}\n\n`));
                }
                if (parsed.type === "message_stop" && !doneSent) {
                  doneSent = true;
                  const result = postProcess(fullText, agente_slug);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, ...result })}\n\n`));
                }
              } catch {}
            }
          }
          if (!doneSent && fullText) {
            const result = postProcess(fullText, agente_slug);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, ...result })}\n\n`));
          }
        } catch (e) {
          console.error("Stream error:", e);
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("Edge function error:", e);
    return new Response(JSON.stringify({ reply: "Erro interno na Edge Function." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ══════════════════════════════════════════
// DATA LOADERS
// ══════════════════════════════════════════

async function loadAgente(sb: any, slug: string) {
  const { data } = await sb.from("agentes").select("*").eq("slug", slug).single();
  return data || { persona: "", contexto: "", memorias: "", inteligencia: "" };
}

async function loadAgenteFiles(sb: any, slug: string): Promise<string> {
  const { data } = await sb.from("agente_arquivos").select("nome, conteudo_texto").eq("agente_slug", slug);
  if (!data || data.length === 0) return "";
  return data.filter((f: any) => f.conteudo_texto).map((f: any) => `[${f.nome}]\n${f.conteudo_texto}`).join("\n\n");
}

async function loadHistory(sb: any, slug: string | null, limit = 20) {
  let q = sb.from("chat_mensagens").select("role, conteudo").order("created_at", { ascending: false }).limit(limit);
  if (slug) q = q.eq("agente_slug", slug);
  else q = q.is("agente_slug", null);
  const { data } = await q;
  return (data || []).reverse().map((h: any) => ({ role: h.role, content: h.conteudo }));
}

// ── LIVE DATA PER AGENT ──

async function loadLiveData(sb: any, slug: string, today: string, entidades: any[]): Promise<string> {
  switch (slug) {
    case "marcos": return loadDataMarcos(sb, today, entidades);
    case "marcela": return loadDataMarcela(sb, today, entidades);
    case "alemao": return loadDataAlemao(sb);
    case "bruno": return loadDataBruno(sb, entidades);
    default: return "";
  }
}

async function loadDataMarcos(sb: any, today: string, entidades: any[]): Promise<string> {
  const cedtecId = entidades.find((e: any) => e.nome === "CEDTEC")?.id;

  const [metaRes, campRes, tarefasRes] = await Promise.all([
    sb.from("cedtec_conta_meta").select("*").limit(1).single(),
    sb.from("meta_campanhas_cache").select("*").order("gasto", { ascending: false }).limit(10),
    cedtecId
      ? sb.from("tarefas").select("titulo, status, prioridade, data_vencimento").eq("entidade_id", cedtecId).neq("status", "concluida").limit(10)
      : Promise.resolve({ data: [] }),
  ]);

  const meta = metaRes.data;
  const campanhas = campRes.data || [];
  const tarefas = tarefasRes.data || [];

  let text = "";

  if (meta) {
    const mediaDiaria = meta.gasto_mes > 0 ? meta.gasto_mes / new Date().getDate() : meta.gasto_hoje || 0;
    const diasVerba = mediaDiaria > 0 ? (meta.saldo_atual / mediaDiaria).toFixed(1) : "—";
    const alerta = mediaDiaria > 0 && meta.saldo_atual / mediaDiaria < 3 ? " *** ALERTA: MENOS DE 3 DIAS DE VERBA" : "";

    text += `Saldo disponivel: ${fmtMoney(meta.saldo_atual)}${alerta}
Gasto hoje: ${fmtMoney(meta.gasto_hoje)}
Gasto no mes: ${fmtMoney(meta.gasto_mes)}
Dias de verba restante: ~${diasVerba} dias
`;
  } else {
    text += "Dados Meta Ads nao disponiveis (nao configurado ou sem sincronizacao)\n";
  }

  if (campanhas.length > 0) {
    text += "\nCampanhas ativas (ultimos 30 dias):\n";
    text += "| Campanha | Gasto | Leads | CPL | CTR | Status |\n";
    for (const c of campanhas) {
      const cplAlerta = c.cpl > 70 ? " *** CPL ACIMA DA META" : "";
      text += `| ${(c.nome || "").slice(0, 30)} | ${fmtMoney(c.gasto)} | ${c.leads || 0} | ${fmtMoney(c.cpl)} | ${c.ctr ? c.ctr.toFixed(1) + "%" : "—"} | ${c.status || "—"} |${cplAlerta}\n`;
    }
  }

  if (tarefas.length > 0) {
    text += "\nTarefas CEDTEC abertas:\n";
    for (const t of tarefas) {
      const atrasada = t.data_vencimento && t.data_vencimento < today ? " [ATRASADA]" : "";
      text += `- ${t.titulo} (${t.prioridade}${t.data_vencimento ? ", vence " + t.data_vencimento : ""})${atrasada}\n`;
    }
  }

  return text;
}

async function loadDataMarcela(sb: any, today: string, entidades: any[]): Promise<string> {
  const todayStart = today + "T00:00:00";
  const todayEnd = today + "T23:59:59";
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) + "T23:59:59";

  const [eventosHoje, eventosSemana, urgentes, atrasadas, saldo, pendentesCount] = await Promise.all([
    sb.from("eventos").select("titulo, data_inicio, data_fim, local, dia_inteiro").gte("data_inicio", todayStart).lte("data_inicio", todayEnd).order("data_inicio"),
    sb.from("eventos").select("titulo, data_inicio, local").gt("data_inicio", todayEnd).lte("data_inicio", weekEnd).order("data_inicio").limit(10),
    sb.from("tarefas").select("titulo, prioridade, data_vencimento, entidade_id").in("prioridade", ["urgente", "alta"]).neq("status", "concluida").limit(10),
    sb.from("tarefas").select("titulo, data_vencimento, entidade_id").lt("data_vencimento", today).neq("status", "concluida").limit(10),
    sb.from("cedtec_conta_meta").select("saldo_atual, gasto_hoje").limit(1).single(),
    sb.from("tarefas").select("id", { count: "exact", head: true }).neq("status", "concluida"),
  ]);

  const entMap: Record<string, string> = {};
  (entidades || []).forEach((e: any) => { entMap[e.id] = e.icone + " " + e.nome; });

  let text = "";

  // Eventos hoje
  const evHoje = eventosHoje.data || [];
  if (evHoje.length > 0) {
    text += "Eventos HOJE:\n";
    for (const e of evHoje) {
      const hora = e.dia_inteiro ? "dia inteiro" : new Date(e.data_inicio).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      text += `- ${hora} — ${e.titulo}${e.local ? " (" + e.local + ")" : ""}\n`;
    }
  } else {
    text += "Nenhum evento hoje.\n";
  }

  // Eventos da semana
  const evSemana = eventosSemana.data || [];
  if (evSemana.length > 0) {
    text += "\nProximos eventos da semana:\n";
    for (const e of evSemana) {
      const dia = new Date(e.data_inicio).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "numeric", month: "short" });
      text += `- ${dia} — ${e.titulo}${e.local ? " (" + e.local + ")" : ""}\n`;
    }
  }

  // Tarefas atrasadas
  const atr = atrasadas.data || [];
  if (atr.length > 0) {
    text += "\nTarefas ATRASADAS:\n";
    for (const t of atr) {
      text += `- [ATRASADA] ${t.titulo} (venceu ${t.data_vencimento}) — ${entMap[t.entidade_id] || "sem empresa"}\n`;
    }
  }

  // Tarefas urgentes/altas
  const urg = (urgentes.data || []).filter((t: any) => !atr.find((a: any) => a.titulo === t.titulo));
  if (urg.length > 0) {
    text += "\nTarefas urgentes/alta prioridade:\n";
    for (const t of urg) {
      text += `- [${t.prioridade.toUpperCase()}] ${t.titulo}${t.data_vencimento ? " (vence " + t.data_vencimento + ")" : ""} — ${entMap[t.entidade_id] || "sem empresa"}\n`;
    }
  }

  // Resumo
  text += `\nResumo: ${pendentesCount.count || 0} tarefas pendentes no total.`;

  // Saldo Meta
  if (saldo.data && saldo.data.saldo_atual > 0) {
    const dias = saldo.data.gasto_hoje > 0 ? (saldo.data.saldo_atual / saldo.data.gasto_hoje).toFixed(1) : "—";
    text += `\nSaldo Meta Ads: ${fmtMoney(saldo.data.saldo_atual)} (~${dias} dias de verba)`;
    if (saldo.data.gasto_hoje > 0 && saldo.data.saldo_atual / saldo.data.gasto_hoje < 3) {
      text += " *** ALERTA: MENOS DE 3 DIAS";
    }
  }

  return text;
}

async function loadDataAlemao(sb: any): Promise<string> {
  const [catRes, lancRes] = await Promise.all([
    sb.from("sitio_categorias").select("id, nome, icone, tipo"),
    sb.from("sitio_lancamentos").select("descricao, valor, tipo, data_realizada, centro_custo_id").order("created_at", { ascending: false }).limit(15),
  ]);

  const categorias = catRes.data || [];
  const lancamentos = lancRes.data || [];

  // Totais por centro
  const totais: Record<string, { nome: string; realizado: number; planejado: number }> = {};
  for (const c of categorias) {
    totais[c.id] = { nome: `${c.icone} ${c.nome}`, realizado: 0, planejado: 0 };
  }

  // Buscar todos lançamentos para totais
  const { data: allLanc } = await sb.from("sitio_lancamentos").select("valor, tipo, centro_custo_id");
  for (const l of allLanc || []) {
    if (totais[l.centro_custo_id]) {
      if (l.tipo === "realizado") totais[l.centro_custo_id].realizado += Number(l.valor);
      else totais[l.centro_custo_id].planejado += Number(l.valor);
    }
  }

  let totalGeral = 0;
  let text = "Investimento por centro de custo:\n| Centro | Realizado | Planejado |\n";
  for (const [id, t] of Object.entries(totais)) {
    if (t.realizado > 0 || t.planejado > 0) {
      text += `| ${t.nome} | ${fmtMoney(t.realizado)} | ${fmtMoney(t.planejado)} |\n`;
      totalGeral += t.realizado;
    }
  }
  text += `\nTotal investido (realizado): ${fmtMoney(totalGeral)}\n`;

  if (lancamentos.length > 0) {
    text += "\nUltimos lancamentos:\n";
    for (const l of lancamentos.slice(0, 10)) {
      const centro = totais[l.centro_custo_id]?.nome || "—";
      text += `- ${l.data_realizada || "s/d"} ${l.descricao} — ${fmtMoney(Number(l.valor))} (${centro}, ${l.tipo})\n`;
    }
  }

  text += "\nCentros de custo disponiveis (use o id ao registrar gastos):\n";
  for (const c of categorias) {
    text += `- ${c.icone} ${c.nome} (id: ${c.id})\n`;
  }

  return text;
}

async function loadDataBruno(sb: any, entidades: any[]): Promise<string> {
  const pincelId = entidades.find((e: any) => e.nome.includes("Pincel"))?.id;
  if (!pincelId) return "Dados do Pincel Atomico nao disponiveis.\n";

  const { data: tarefas } = await sb.from("tarefas")
    .select("titulo, status, prioridade, data_vencimento")
    .eq("entidade_id", pincelId)
    .neq("status", "concluida")
    .limit(10);

  let text = "";
  if (tarefas && tarefas.length > 0) {
    text += "Tarefas Pincel Atomico abertas:\n";
    for (const t of tarefas) {
      text += `- ${t.titulo} (${t.prioridade}${t.data_vencimento ? ", vence " + t.data_vencimento : ""})\n`;
    }
  } else {
    text += "Nenhuma tarefa aberta para o Pincel Atomico.\n";
  }
  return text;
}

async function loadDispatchSummary(sb: any, today: string): Promise<string> {
  const todayStart = today + "T00:00:00";
  const todayEnd = today + "T23:59:59";

  const [pendentes, urgentes, eventosHoje, saldo] = await Promise.all([
    sb.from("tarefas").select("id", { count: "exact", head: true }).neq("status", "concluida"),
    sb.from("tarefas").select("id", { count: "exact", head: true }).eq("prioridade", "urgente").neq("status", "concluida"),
    sb.from("eventos").select("titulo, data_inicio").gte("data_inicio", todayStart).lte("data_inicio", todayEnd).order("data_inicio"),
    sb.from("cedtec_conta_meta").select("saldo_atual").limit(1).single(),
  ]);

  let text = `Tarefas pendentes: ${pendentes.count || 0} (${urgentes.count || 0} urgentes)\n`;

  const evts = eventosHoje.data || [];
  if (evts.length > 0) {
    text += `Eventos hoje: ${evts.map((e: any) => e.titulo).join(", ")}\n`;
  } else {
    text += "Nenhum evento hoje.\n";
  }

  if (saldo.data) {
    text += `Saldo Meta Ads: ${fmtMoney(saldo.data.saldo_atual)}\n`;
  }

  return text;
}

// ══════════════════════════════════════════
// SYSTEM PROMPTS
// ══════════════════════════════════════════

function buildAgentePrompt(agente: any, liveData: string, files: string, entList: string, date: string, time: string): string {
  const persona = trim(agente.persona || "Assistente especializado.", 2000);
  const contexto = trim(agente.contexto || "", 2000);
  const memorias = trim(agente.memorias || "", 2000);
  const inteligencia = trim((agente.inteligencia || "") + (files ? "\n\n[ARQUIVOS DE REFERÊNCIA]\n" + files : ""), 4000);

  return `[IDENTIDADE]
${persona}

[DADOS EM TEMPO REAL — atualizado agora]
${trim(liveData, 4000) || "Nenhum dado em tempo real disponivel."}

[CONTEXTO DO NEGÓCIO]
${contexto || "Sem contexto adicional."}

[MEMÓRIAS DE CONVERSAS ANTERIORES]
${memorias || "Nenhuma memória ainda."}

[BASE DE CONHECIMENTO]
${inteligencia || "Nenhuma base adicional."}

[EMPRESAS DO PEDRO — use o id exato ao criar tarefas/eventos/gastos]
${entList}

[MOMENTO ATUAL]
Hoje é ${date}. São ${time} no horário de Brasília.

[INSTRUÇÃO DE AÇÕES]
Se o Pedro pedir para criar tarefa, evento ou registrar gasto, inclua no FINAL da sua resposta (depois do texto normal):
---ACTION---
{"action": "tarefa|evento|gasto", "actionData": {"titulo": "...", "entidade_id": "uuid-da-empresa", ...campos}}
---END_ACTION---
Campos por ação:
- tarefa: titulo, descricao, entidade_id, prioridade (baixa|media|alta|urgente), data_vencimento (YYYY-MM-DD)
- evento: titulo, data_inicio (ISO), data_fim (ISO), local, entidade_id, dia_inteiro (bool)
- gasto: descricao, valor (numero), centro_custo_id (uuid), tipo (realizado|planejado), data_realizada (YYYY-MM-DD)

[INSTRUÇÃO DE MEMÓRIA]
Se nessa conversa voce aprender algo relevante sobre preferências, decisões ou padrões do Pedro, inclua no FINAL:
---MEMORY---
texto objetivo da memória
---END_MEMORY---
Só sugira quando for genuinamente útil para conversas futuras.`;
}

function buildDispatchPrompt(summaryData: string, entList: string, date: string, time: string): string {
  return `Voce é o assistente pessoal do Pedro Pertel. Ele administra múltiplas empresas em Vitória-ES e usa este sistema como seu sistema operacional pessoal.

Seja direto, objetivo e útil. Responda em português brasileiro.

[DADOS EM TEMPO REAL]
${summaryData}

[EMPRESAS — use o id exato ao criar tarefas/eventos]
${entList}

[MOMENTO]
Hoje é ${date}. São ${time} (Brasília).

[INSTRUÇÃO DE AÇÕES]
Se o Pedro pedir para criar tarefa, evento ou registrar gasto, inclua no FINAL:
---ACTION---
{"action": "tarefa|evento|gasto", "actionData": {"titulo": "...", "entidade_id": "uuid", ...campos}}
---END_ACTION---
Campos por ação:
- tarefa: titulo, descricao, entidade_id, prioridade (baixa|media|alta|urgente), data_vencimento (YYYY-MM-DD)
- evento: titulo, data_inicio (ISO), data_fim (ISO), local, entidade_id, dia_inteiro (bool)
- gasto: descricao, valor (numero), centro_custo_id (uuid), tipo (realizado|planejado), data_realizada (YYYY-MM-DD)`;
}

// ══════════════════════════════════════════
// POST-PROCESSING
// ══════════════════════════════════════════

function postProcess(text: string, agenteSlug: string | null) {
  let reply = text;
  let action = null;
  let actionData = null;
  let memorySuggest = null;

  const actionMatch = text.match(/---ACTION---\s*([\s\S]*?)\s*---END_ACTION---/);
  if (actionMatch) {
    try {
      let jsonStr = actionMatch[1].trim();
      jsonStr = jsonStr.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      const parsed = JSON.parse(jsonStr);
      action = parsed.action;
      actionData = postProcessActionData(parsed.actionData || parsed);
      reply = text.replace(/---ACTION---[\s\S]*?---END_ACTION---/, "").trim();
    } catch (e) {
      console.error("Action parse error:", e, "Raw:", actionMatch[1]);
    }
  }

  const memMatch = text.match(/---MEMORY---\s*([\s\S]*?)\s*---END_MEMORY---/);
  if (memMatch) {
    memorySuggest = memMatch[1].trim();
    reply = reply.replace(/---MEMORY---[\s\S]*?---END_MEMORY---/, "").trim();
  }

  return { reply, action, actionData, agente: agenteSlug, memory_suggest: memorySuggest };
}

function postProcessActionData(data: any): any {
  if (!data) return data;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  const normalizeDate = (val: string): string => {
    if (!val) return val;
    const lower = val.toLowerCase().trim();
    if (lower === "hoje") return today;
    if (lower === "amanhã" || lower === "amanha") return tomorrow;
    const brMatch = lower.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
    return val;
  };

  for (const key of ["data_vencimento", "data_inicio", "data_fim", "data_realizada", "data_prevista"]) {
    if (data[key] && typeof data[key] === "string") {
      data[key] = normalizeDate(data[key]);
    }
  }
  return data;
}
