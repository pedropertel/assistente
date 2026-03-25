// ══════════════════════════════════════════
// EDGE FUNCTION: meta-sync
// Sincroniza campanhas Meta Ads → meta_campanhas_cache
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

    const accountId = ad_account_id.startsWith("act_") ? ad_account_id : `act_${ad_account_id}`;

    // Buscar campanhas ativas
    const campaignsUrl = `https://graph.facebook.com/v19.0/${accountId}/campaigns?fields=id,name,status,objective&effective_status=["ACTIVE","PAUSED"]&limit=50&access_token=${access_token}`;
    const campRes = await fetch(campaignsUrl);
    const campData = await campRes.json();

    if (campData.error) {
      await supabase
        .from("meta_conexoes")
        .update({ status: "erro", updated_at: new Date().toISOString() })
        .eq("id", conexao.id);
      return new Response(JSON.stringify({ error: campData.error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaigns = campData.data || [];
    let synced = 0;

    // Periodo: ultimos 30 dias
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    for (const camp of campaigns) {
      // Buscar insights da campanha
      const insUrl = `https://graph.facebook.com/v19.0/${camp.id}/insights?fields=spend,impressions,clicks,ctr,cpc,actions&time_range={"since":"${thirtyDaysAgo}","until":"${today}"}&access_token=${access_token}`;
      const insRes = await fetch(insUrl);
      const insData = await insRes.json();
      const ins = insData.data?.[0] || {};

      // Extrair leads (actions type: lead, onsite_conversion.lead_grouped, etc.)
      let leads = 0;
      if (ins.actions) {
        for (const a of ins.actions) {
          if (a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped" || a.action_type === "offsite_conversion.fb_pixel_lead") {
            leads += parseInt(a.value || "0");
          }
        }
      }

      const gasto = parseFloat(ins.spend || "0");
      const impressions = parseInt(ins.impressions || "0");
      const clicks = parseInt(ins.clicks || "0");
      const ctr = parseFloat(ins.ctr || "0");
      const cpc = parseFloat(ins.cpc || "0");
      const cpl = leads > 0 ? gasto / leads : 0;

      // Upsert na cache
      const { error: upsertErr } = await supabase
        .from("meta_campanhas_cache")
        .upsert({
          campaign_id: camp.id,
          nome: camp.name,
          status: camp.status,
          objetivo: camp.objective || null,
          gasto,
          impressoes: impressions,
          cliques: clicks,
          ctr,
          cpc,
          leads,
          cpl,
          updated_at: new Date().toISOString(),
        }, { onConflict: "campaign_id" });

      if (!upsertErr) synced++;
    }

    // Atualizar conexao
    await supabase
      .from("meta_conexoes")
      .update({ status: "conectado", last_sync_at: new Date().toISOString() })
      .eq("id", conexao.id);

    // Tambem atualizar saldo (aproveita a chamada)
    const balanceAccountId = accountId;
    const balUrl = `https://graph.facebook.com/v21.0/${balanceAccountId}?fields=balance,amount_spent,spend_cap&access_token=${access_token}`;
    const balRes = await fetch(balUrl);
    const balData = await balRes.json();

    if (!balData.error) {
      const balance = parseFloat(balData.balance || "0") / 100;
      const insToday = `https://graph.facebook.com/v21.0/${balanceAccountId}/insights?fields=spend&time_range={"since":"${today}","until":"${today}"}&access_token=${access_token}`;
      const todayRes = await fetch(insToday);
      const todayData = await todayRes.json();
      const gastoHoje = todayData.data?.[0]?.spend ? parseFloat(todayData.data[0].spend) : 0;

      const firstOfMonth = today.slice(0, 8) + "01";
      const monthUrl = `https://graph.facebook.com/v21.0/${balanceAccountId}/insights?fields=spend&time_range={"since":"${firstOfMonth}","until":"${today}"}&access_token=${access_token}`;
      const monthRes = await fetch(monthUrl);
      const monthData = await monthRes.json();
      const gastoMes = monthData.data?.[0]?.spend ? parseFloat(monthData.data[0].spend) : 0;

      await supabase
        .from("cedtec_conta_meta")
        .update({
          saldo_atual: balance,
          gasto_hoje: gastoHoje,
          gasto_mes: gastoMes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", (await supabase.from("cedtec_conta_meta").select("id").limit(1).single()).data?.id);
    }

    return new Response(JSON.stringify({ synced, total: campaigns.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
