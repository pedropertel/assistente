// ══════════════════════════════════════════
// EDGE FUNCTION: chat-claude
// IA Dispatch + Agentes Especializados
// Modelo: claude-haiku-4-5-20251001
// ══════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ reply: "ANTHROPIC_API_KEY nao configurada nos Secrets." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      message,
      image,
      images,
      agente_slug,
      agente_persona,
      agente_contexto,
      agente_memorias,
      agente_inteligencia,
      historico,
      entidades,
    } = body;

    // Hora de Brasília
    const now = new Date();
    const brTime = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const brDate = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long", year: "numeric" });

    let systemPrompt: string;
    let messages: Array<{ role: string; content: string }>;

    if (agente_slug) {
      // ── MODO AGENTE ──
      systemPrompt = buildAgentePrompt(
        agente_persona,
        agente_contexto,
        agente_memorias,
        agente_inteligencia,
        brDate,
        brTime,
        entidades
      );
    } else {
      // ── MODO DISPATCH ──
      const domain = await classifyDomain(apiKey, message);
      systemPrompt = buildDispatchPrompt(domain, brDate, brTime, entidades);
    }

    // Montar messages com histórico
    messages = [];
    if (historico && Array.isArray(historico)) {
      for (const h of historico.slice(-10)) {
        if (h.role && h.conteudo) {
          messages.push({ role: h.role, content: h.conteudo });
        } else if (h.role && h.content) {
          messages.push({ role: h.role, content: h.content });
        }
      }
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
      messages.push({
        role: "user",
        content: [...imageBlocks, { type: "text", text: message }],
      });
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
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
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

    // Stream SSE para o frontend
    const reader = anthropicResp.body!.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                const token = parsed.delta.text;
                fullText += token;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
              }

              if (parsed.type === "message_stop") {
                // Processar texto completo para actions e memory_suggest
                const result = postProcess(fullText, agente_slug);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, ...result })}\n\n`));
              }
            } catch {}
          }
        }

        // Se message_stop não veio, enviar done mesmo assim
        if (fullText) {
          const result = postProcess(fullText, agente_slug);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, ...result })}\n\n`));
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (e) {
    console.error("Edge function error:", e);
    return new Response(JSON.stringify({ reply: "Erro interno na Edge Function." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── CLASSIFICAÇÃO DE DOMÍNIO (dispatch) ──

async function classifyDomain(apiKey: string, message: string): Promise<string> {
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 20,
        system: "Classifique a mensagem do usuario em exatamente uma palavra: tarefas | agenda | cedtec | sitio | grafica | geral. Responda APENAS a palavra.",
        messages: [{ role: "user", content: message }],
      }),
    });
    const data = await resp.json();
    const domain = (data.content?.[0]?.text || "geral").trim().toLowerCase();
    const valid = ["tarefas", "agenda", "cedtec", "sitio", "grafica", "geral"];
    return valid.includes(domain) ? domain : "geral";
  } catch {
    return "geral";
  }
}

// ── SYSTEM PROMPTS ──

function buildAgentePrompt(
  persona: string, contexto: string, memorias: string,
  inteligencia: string, date: string, time: string,
  entidades: any[]
): string {
  const entList = (entidades || []).map((e: any) => `${e.icone} ${e.nome} (${e.tipo})`).join(", ");

  return `[IDENTIDADE]
${persona}

[CONTEXTO DO NEGÓCIO]
${contexto || "Sem contexto adicional."}

[MEMÓRIAS E APRENDIZADOS]
${memorias || "Nenhuma memória ainda."}

[BASE DE CONHECIMENTO]
${inteligencia || "Nenhuma base adicional."}

[EMPRESAS DO PEDRO]
${entList}

[MOMENTO ATUAL]
Hoje é ${date}. São ${time} no horário de Brasília.

[INSTRUÇÃO DE AÇÕES]
Se o Pedro pedir para criar tarefa, evento ou registrar gasto, inclua no final da sua resposta um bloco JSON (e SOMENTE no final):
---ACTION---
{"action": "tarefa|evento|gasto", "actionData": {campos}}
---END_ACTION---

[INSTRUÇÃO DE MEMÓRIA]
Se nessa conversa você aprender algo relevante sobre preferências ou negócio do Pedro que deva ser lembrado no futuro, inclua no final:
---MEMORY---
texto objetivo da memória
---END_MEMORY---
Só sugira quando for realmente relevante.`;
}

function buildDispatchPrompt(domain: string, date: string, time: string, entidades: any[]): string {
  const entList = (entidades || []).map((e: any) => `${e.icone} ${e.nome}`).join(", ");

  const domainContext: Record<string, string> = {
    tarefas: "Você é o assistente de tarefas do Pedro. Ajude a criar, organizar e priorizar tarefas entre suas empresas.",
    agenda: "Você é o assistente de agenda do Pedro. Ajude a criar eventos, organizar compromissos e gerenciar o calendário.",
    cedtec: "Você é o assistente de marketing digital do CEDTEC. Pedro faz 100% do marketing sozinho via Meta Ads. Ajude com análise de campanhas, CPL, saldo de verba.",
    sitio: "Você é o assistente financeiro do Sítio Monte da Vitória. Projeto de café arábica em fase de investimento. Ajude a registrar gastos, consultar centros de custo, analisar investimentos.",
    grafica: "Você é o assistente da Gráfica do Pedro. Ajude com pedidos, parcelas e controle financeiro.",
    geral: "Você é o assistente pessoal do Pedro Pertel. Ele administra 5 empresas em Vitória-ES. Ajude com qualquer assunto.",
  };

  return `${domainContext[domain] || domainContext.geral}

[EMPRESAS] ${entList}

[MOMENTO] Hoje é ${date}. São ${time} (Brasília).

[INSTRUÇÃO DE AÇÕES]
Se o Pedro pedir para criar tarefa, evento ou registrar gasto, inclua no final:
---ACTION---
{"action": "tarefa|evento|gasto", "actionData": {campos}}
---END_ACTION---`;
}

// ── PÓS-PROCESSAMENTO ──

function postProcess(text: string, agenteSlug: string | null) {
  let reply = text;
  let action = null;
  let actionData = null;
  let memorySuggest = null;

  // Extrair action
  const actionMatch = text.match(/---ACTION---\s*([\s\S]*?)\s*---END_ACTION---/);
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1].trim());
      action = parsed.action;
      actionData = postProcessActionData(parsed.actionData || parsed);
      reply = text.replace(/---ACTION---[\s\S]*?---END_ACTION---/, "").trim();
    } catch (e) {
      console.error("Action parse error:", e);
    }
  }

  // Extrair memory
  const memMatch = text.match(/---MEMORY---\s*([\s\S]*?)\s*---END_MEMORY---/);
  if (memMatch) {
    memorySuggest = memMatch[1].trim();
    reply = reply.replace(/---MEMORY---[\s\S]*?---END_MEMORY---/, "").trim();
  }

  return {
    reply,
    action,
    actionData,
    agente: agenteSlug,
    memory_suggest: memorySuggest,
  };
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

    // DD/MM/AAAA → YYYY-MM-DD
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
