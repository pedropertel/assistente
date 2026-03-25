// ══════════════════════════════════════════
// EDGE FUNCTION: chat-claude v3
// Smart Orchestrator · Sonnet · Tool Use nativo
// ══════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5-20250514";
// Fallback: se Sonnet falhar, tentar Haiku
const FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 8192;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getSupabase() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function trim(text: string, max: number): string {
  if (!text || text.length <= max) return text;
  return text.slice(0, max) + "\n... (truncado)";
}

function fmtMoney(v: number): string {
  return `R$ ${(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

// ══════════════════════════════════════════
// TOOLS — ações que o Claude pode executar
// ══════════════════════════════════════════

const TOOLS = [
  {
    name: "criar_tarefa",
    description: "Cria uma nova tarefa no sistema. Use quando Pedro pedir para criar, anotar, lembrar de fazer algo, ou quando voce identificar algo que precisa ser feito.",
    input_schema: {
      type: "object" as const,
      properties: {
        titulo: { type: "string", description: "Titulo claro e curto da tarefa" },
        descricao: { type: "string", description: "Descricao detalhada (opcional)" },
        entidade_id: { type: "string", description: "UUID da empresa associada (ver lista no prompt)" },
        prioridade: { type: "string", enum: ["baixa", "media", "alta", "urgente"] },
        data_vencimento: { type: "string", description: "Data limite no formato YYYY-MM-DD" },
      },
      required: ["titulo"],
    },
  },
  {
    name: "criar_evento",
    description: "Cria evento na agenda. Use quando Pedro pedir para agendar, marcar reuniao, compromisso.",
    input_schema: {
      type: "object" as const,
      properties: {
        titulo: { type: "string" },
        data_inicio: { type: "string", description: "Datetime ISO (ex: 2026-03-25T14:00:00)" },
        data_fim: { type: "string", description: "Datetime ISO" },
        local: { type: "string" },
        entidade_id: { type: "string", description: "UUID da empresa" },
        dia_inteiro: { type: "boolean" },
      },
      required: ["titulo", "data_inicio"],
    },
  },
  {
    name: "registrar_gasto",
    description: "Registra lancamento financeiro do Sitio Monte da Vitoria. Use quando Pedro informar gasto, pagamento, ou despesa do sitio.",
    input_schema: {
      type: "object" as const,
      properties: {
        descricao: { type: "string" },
        valor: { type: "number", description: "Valor em reais" },
        centro_custo_id: { type: "string", description: "UUID do centro de custo (ver lista no prompt)" },
        tipo: { type: "string", enum: ["realizado", "planejado"] },
        data_realizada: { type: "string", description: "YYYY-MM-DD (default: hoje)" },
      },
      required: ["descricao", "valor"],
    },
  },
  {
    name: "sugerir_memoria",
    description: "Salva uma informacao importante sobre preferencias, decisoes ou padroes do Pedro para lembrar em conversas futuras. Use APENAS quando genuinamente relevante — nao para fatos triviais.",
    input_schema: {
      type: "object" as const,
      properties: {
        texto: { type: "string", description: "Texto objetivo e curto da memoria" },
      },
      required: ["texto"],
    },
  },
];

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

    // Carregar entidades
    const { data: entidades } = await sb.from("entidades").select("id, nome, tipo, icone").order("ordem");
    const entList = (entidades || []).map((e: any) => `${e.icone} ${e.nome} (id: ${e.id})`).join("\n");

    // Carregar histórico server-side
    const history = await loadHistory(sb, agente_slug, 20);

    let systemPrompt: string;

    if (agente_slug) {
      const agente = await loadAgente(sb, agente_slug);
      const agenteFiles = await loadAgenteFiles(sb, agente_slug);
      const liveData = await loadLiveData(sb, agente_slug, todayISO, entidades || []);
      systemPrompt = buildAgentePrompt(agente, liveData, agenteFiles, entList, brDate, brTime);
    } else {
      const summaryData = await loadDispatchSummary(sb, todayISO);
      systemPrompt = buildDispatchPrompt(summaryData, entList, brDate, brTime);
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

    // Chamar Anthropic API com streaming + tools
    const anthropicResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
        tools: TOOLS,
        stream: true,
      }),
    });

    if (!anthropicResp.ok) {
      const err = await anthropicResp.text();
      console.error("Anthropic error:", err);
      return new Response(JSON.stringify({ reply: "Erro na API da IA. Tente novamente." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stream SSE com suporte a tool_use
    const reader = anthropicResp.body!.getReader();
    const decoder = new TextDecoder();

    let fullText = "";
    const toolCalls: Array<{ name: string; input: any }> = [];
    let currentToolName = "";
    let currentToolJson = "";
    let inToolBlock = false;
    let doneSent = false;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendDone = () => {
          if (doneSent) return;
          doneSent = true;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            done: true,
            reply: fullText,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          })}\n\n`));
        };

        try {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Processar linhas completas
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // manter linha incompleta no buffer

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (!data || data === "[DONE]") continue;

              try {
                const ev = JSON.parse(data);

                // Texto normal — stream token por token
                if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                  const token = ev.delta.text;
                  fullText += token;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                }

                // Tool use — início
                if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
                  currentToolName = ev.content_block.name;
                  currentToolJson = "";
                  inToolBlock = true;
                }

                // Tool use — acumular JSON
                if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta") {
                  currentToolJson += ev.delta.partial_json;
                }

                // Fim de qualquer content block
                if (ev.type === "content_block_stop" && inToolBlock) {
                  try {
                    const input = currentToolJson ? JSON.parse(currentToolJson) : {};
                    toolCalls.push({ name: currentToolName, input });
                  } catch (e) {
                    console.error("Tool JSON parse error:", e, "raw:", currentToolJson);
                  }
                  currentToolName = "";
                  currentToolJson = "";
                  inToolBlock = false;
                }

                // message_delta com stop_reason
                if (ev.type === "message_delta") {
                  sendDone();
                }

                // message_stop
                if (ev.type === "message_stop") {
                  sendDone();
                }
              } catch {}
            }
          }

          // Processar buffer restante
          if (buffer.startsWith("data: ")) {
            try {
              const ev = JSON.parse(buffer.slice(6).trim());
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                fullText += ev.delta.text;
              }
            } catch {}
          }

          sendDone();
        } catch (e) {
          console.error("Stream error:", e);
          sendDone();
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
    cedtecId ? sb.from("tarefas").select("titulo, status, prioridade, data_vencimento").eq("entidade_id", cedtecId).neq("status", "concluida").limit(10) : Promise.resolve({ data: [] }),
  ]);

  const meta = metaRes.data;
  const campanhas = campRes.data || [];
  const tarefas = tarefasRes.data || [];
  let text = "";

  if (meta) {
    const mediaDiaria = meta.gasto_mes > 0 ? meta.gasto_mes / new Date().getDate() : meta.gasto_hoje || 0;
    const diasVerba = mediaDiaria > 0 ? (meta.saldo_atual / mediaDiaria).toFixed(1) : "—";
    const alerta = mediaDiaria > 0 && meta.saldo_atual / mediaDiaria < 3 ? " *** ALERTA: MENOS DE 3 DIAS DE VERBA" : "";
    text += `Saldo disponivel: ${fmtMoney(meta.saldo_atual)}${alerta}\nGasto hoje: ${fmtMoney(meta.gasto_hoje)}\nGasto no mes: ${fmtMoney(meta.gasto_mes)}\nDias de verba restante: ~${diasVerba} dias\n`;
  } else {
    text += "Dados Meta Ads nao disponiveis.\n";
  }

  if (campanhas.length > 0) {
    text += "\nCampanhas ativas (ultimos 30 dias):\n| Campanha | Gasto | Leads | CPL | CTR | Status |\n";
    for (const c of campanhas) {
      const cplAlerta = c.cpl > 70 ? " *** CPL ALTO" : "";
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
  const evHoje = eventosHoje.data || [];
  if (evHoje.length > 0) {
    text += "Eventos HOJE:\n";
    for (const e of evHoje) {
      const hora = e.dia_inteiro ? "dia inteiro" : new Date(e.data_inicio).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      text += `- ${hora} — ${e.titulo}${e.local ? " (" + e.local + ")" : ""}\n`;
    }
  } else { text += "Nenhum evento hoje.\n"; }

  const evSemana = eventosSemana.data || [];
  if (evSemana.length > 0) {
    text += "\nProximos eventos da semana:\n";
    for (const e of evSemana) {
      const dia = new Date(e.data_inicio).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "numeric", month: "short" });
      text += `- ${dia} — ${e.titulo}${e.local ? " (" + e.local + ")" : ""}\n`;
    }
  }

  const atr = atrasadas.data || [];
  if (atr.length > 0) {
    text += "\nTarefas ATRASADAS:\n";
    for (const t of atr) { text += `- [ATRASADA] ${t.titulo} (venceu ${t.data_vencimento}) — ${entMap[t.entidade_id] || "sem empresa"}\n`; }
  }

  const urg = (urgentes.data || []).filter((t: any) => !atr.find((a: any) => a.titulo === t.titulo));
  if (urg.length > 0) {
    text += "\nTarefas urgentes/alta prioridade:\n";
    for (const t of urg) { text += `- [${t.prioridade.toUpperCase()}] ${t.titulo}${t.data_vencimento ? " (vence " + t.data_vencimento + ")" : ""} — ${entMap[t.entidade_id] || "sem empresa"}\n`; }
  }

  text += `\nResumo: ${pendentesCount.count || 0} tarefas pendentes no total.`;

  if (saldo.data?.saldo_atual > 0) {
    const dias = saldo.data.gasto_hoje > 0 ? (saldo.data.saldo_atual / saldo.data.gasto_hoje).toFixed(1) : "—";
    text += `\nSaldo Meta Ads: ${fmtMoney(saldo.data.saldo_atual)} (~${dias} dias)`;
    if (saldo.data.gasto_hoje > 0 && saldo.data.saldo_atual / saldo.data.gasto_hoje < 3) text += " *** ALERTA";
  }
  return text;
}

async function loadDataAlemao(sb: any): Promise<string> {
  const [catRes, lancRes, allLancRes] = await Promise.all([
    sb.from("sitio_categorias").select("id, nome, icone, tipo"),
    sb.from("sitio_lancamentos").select("descricao, valor, tipo, data_realizada, centro_custo_id").order("created_at", { ascending: false }).limit(15),
    sb.from("sitio_lancamentos").select("valor, tipo, centro_custo_id"),
  ]);

  const categorias = catRes.data || [];
  const lancamentos = lancRes.data || [];
  const totais: Record<string, { nome: string; realizado: number; planejado: number }> = {};
  for (const c of categorias) { totais[c.id] = { nome: `${c.icone} ${c.nome}`, realizado: 0, planejado: 0 }; }
  for (const l of allLancRes.data || []) {
    if (totais[l.centro_custo_id]) {
      if (l.tipo === "realizado") totais[l.centro_custo_id].realizado += Number(l.valor);
      else totais[l.centro_custo_id].planejado += Number(l.valor);
    }
  }

  let totalGeral = 0;
  let text = "Investimento por centro de custo:\n| Centro | Realizado | Planejado |\n";
  for (const [, t] of Object.entries(totais)) {
    if (t.realizado > 0 || t.planejado > 0) { text += `| ${t.nome} | ${fmtMoney(t.realizado)} | ${fmtMoney(t.planejado)} |\n`; totalGeral += t.realizado; }
  }
  text += `\nTotal investido (realizado): ${fmtMoney(totalGeral)}\n`;

  if (lancamentos.length > 0) {
    text += "\nUltimos lancamentos:\n";
    for (const l of lancamentos.slice(0, 10)) {
      text += `- ${l.data_realizada || "s/d"} ${l.descricao} — ${fmtMoney(Number(l.valor))} (${totais[l.centro_custo_id]?.nome || "—"}, ${l.tipo})\n`;
    }
  }

  text += "\nCentros de custo (use o id ao registrar gastos com a tool registrar_gasto):\n";
  for (const c of categorias) { text += `- ${c.icone} ${c.nome} (id: ${c.id})\n`; }
  return text;
}

async function loadDataBruno(sb: any, entidades: any[]): Promise<string> {
  const pincelId = entidades.find((e: any) => e.nome.includes("Pincel"))?.id;
  if (!pincelId) return "Dados do Pincel Atomico nao disponiveis.\n";
  const { data: tarefas } = await sb.from("tarefas").select("titulo, status, prioridade, data_vencimento").eq("entidade_id", pincelId).neq("status", "concluida").limit(10);
  let text = "";
  if (tarefas && tarefas.length > 0) {
    text += "Tarefas Pincel Atomico abertas:\n";
    for (const t of tarefas) { text += `- ${t.titulo} (${t.prioridade}${t.data_vencimento ? ", vence " + t.data_vencimento : ""})\n`; }
  } else { text += "Nenhuma tarefa aberta para o Pincel Atomico.\n"; }
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
  text += evts.length > 0 ? `Eventos hoje: ${evts.map((e: any) => e.titulo).join(", ")}\n` : "Nenhum evento hoje.\n";
  if (saldo.data) text += `Saldo Meta Ads: ${fmtMoney(saldo.data.saldo_atual)}\n`;
  return text;
}

// ══════════════════════════════════════════
// SYSTEM PROMPTS
// ══════════════════════════════════════════

function buildAgentePrompt(agente: any, liveData: string, files: string, entList: string, date: string, time: string): string {
  const persona = trim(agente.persona || "Assistente especializado.", 3000);
  const contexto = trim(agente.contexto || "", 3000);
  const memorias = trim(agente.memorias || "", 3000);
  const inteligencia = trim((agente.inteligencia || "") + (files ? "\n\n[ARQUIVOS DE REFERÊNCIA]\n" + files : ""), 6000);

  return `[IDENTIDADE]
${persona}

[DADOS EM TEMPO REAL — atualizado agora]
${trim(liveData, 6000) || "Nenhum dado em tempo real disponivel."}

[CONTEXTO DO NEGÓCIO]
${contexto || "Sem contexto adicional."}

[MEMÓRIAS DE CONVERSAS ANTERIORES]
${memorias || "Nenhuma memória ainda."}

[BASE DE CONHECIMENTO]
${inteligencia || "Nenhuma base adicional."}

[EMPRESAS DO PEDRO — use o id exato nas tools quando criar tarefas/eventos/gastos]
${entList}

[MOMENTO ATUAL]
Hoje é ${date}. São ${time} no horário de Brasília.

[INSTRUÇÕES]
- Responda em português brasileiro, de forma direta e objetiva
- Use as tools disponíveis quando Pedro pedir para criar tarefas, eventos ou registrar gastos
- Use a tool sugerir_memoria APENAS quando aprender algo genuinamente útil sobre preferências ou decisões do Pedro
- Sempre use os dados em tempo real para fundamentar suas respostas
- Quando criar tarefa/evento, use o entidade_id correto da lista de empresas
- Quando registrar gasto do sítio, use o centro_custo_id correto da lista`;
}

function buildDispatchPrompt(summaryData: string, entList: string, date: string, time: string): string {
  return `Voce é o assistente pessoal do Pedro Pertel. Ele administra múltiplas empresas em Vitória-ES.

Seja direto, objetivo e útil. Responda em português brasileiro.

[DADOS EM TEMPO REAL]
${summaryData}

[EMPRESAS — use o id exato nas tools]
${entList}

[MOMENTO]
Hoje é ${date}. São ${time} (Brasília).

[INSTRUÇÕES]
- Use as tools quando Pedro pedir para criar tarefas, eventos ou registrar gastos
- Use os dados em tempo real quando relevantes`;
}
