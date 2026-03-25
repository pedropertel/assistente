// ══════════════════════════════════════════
// EDGE FUNCTION: meta-balance
// Busca saldo em tempo real da conta Meta Ads
// ══════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar credenciais Meta
    const { data: conexao, error: conErr } = await supabase
      .from("meta_conexoes")
      .select("*")
      .limit(1)
      .single();

    if (conErr || !conexao) {
      return new Response(JSON.stringify({ error: "Meta Ads nao configurado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ad_account_id, access_token } = conexao;
    if (!ad_account_id || !access_token) {
      return new Response(JSON.stringify({ error: "Credenciais Meta incompletas" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Chamar Meta Graph API — saldo da conta
    const accountId = ad_account_id.startsWith("act_") ? ad_account_id : `act_${ad_account_id}`;
    const metaUrl = `https://graph.facebook.com/v21.0/${accountId}?fields=balance,amount_spent,spend_cap,currency&access_token=${access_token}`;

    const metaRes = await fetch(metaUrl);
    const metaData = await metaRes.json();

    if (metaData.error) {
      // Atualizar status da conexao
      await supabase
        .from("meta_conexoes")
        .update({ status: "erro", updated_at: new Date().toISOString() })
        .eq("id", conexao.id);

      return new Response(JSON.stringify({ error: metaData.error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Meta retorna valores em centavos (string)
    const balance = parseFloat(metaData.balance || "0") / 100;
    const amountSpent = parseFloat(metaData.amount_spent || "0") / 100;
    const spendCap = parseFloat(metaData.spend_cap || "0") / 100;

    // Buscar gasto de hoje via insights
    const today = new Date().toISOString().slice(0, 10);
    const insightsUrl = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=spend&time_range={"since":"${today}","until":"${today}"}&access_token=${access_token}`;
    const insRes = await fetch(insightsUrl);
    const insData = await insRes.json();
    const gastoHoje = insData.data?.[0]?.spend ? parseFloat(insData.data[0].spend) : 0;

    // Buscar gasto do mes
    const firstOfMonth = today.slice(0, 8) + "01";
    const monthUrl = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=spend&time_range={"since":"${firstOfMonth}","until":"${today}"}&access_token=${access_token}`;
    const monthRes = await fetch(monthUrl);
    const monthData = await monthRes.json();
    const gastoMes = monthData.data?.[0]?.spend ? parseFloat(monthData.data[0].spend) : 0;

    // Atualizar banco de dados
    const { error: updateErr } = await supabase
      .from("cedtec_conta_meta")
      .update({
        saldo_atual: balance,
        gasto_hoje: gastoHoje,
        gasto_mes: gastoMes,
        limite: spendCap > 0 ? spendCap : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (await supabase.from("cedtec_conta_meta").select("id").limit(1).single()).data?.id);

    // Atualizar status conexao
    await supabase
      .from("meta_conexoes")
      .update({ status: "conectado", last_sync_at: new Date().toISOString() })
      .eq("id", conexao.id);

    return new Response(JSON.stringify({
      saldo_atual: balance,
      gasto_hoje: gastoHoje,
      gasto_mes: gastoMes,
      limite: spendCap,
      currency: metaData.currency || "BRL",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
