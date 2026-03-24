// ══════════════════════════════════════════
// SUPABASE — INSTÂNCIA ÚNICA
// NUNCA criar outro client em outro arquivo
// ══════════════════════════════════════════

const SUPABASE_URL = 'https://msbwplsknncnxwsalumd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYndwbHNrbm5jbnh3c2FsdW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTUzMTAsImV4cCI6MjA4OTQzMTMxMH0.qDSAYC8KQO_PQsdRrwsIdYWdkrwqO2riFiDjJ08zctI';

// O UMD do Supabase v2 expõe window.supabase
const sb = window.supabase || window.supabaseJs;
export const supabase = sb.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers com error handling ──

export async function query(table, { select = '*', filter, order, limit } = {}) {
  let q = supabase.from(table).select(select);
  if (filter) Object.entries(filter).forEach(([k, v]) => q = q.eq(k, v));
  if (order) q = q.order(order.col, { ascending: order.asc ?? true });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function insert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select();
  if (error) throw error;
  return data?.[0];
}

export async function update(table, id, changes) {
  const { data, error } = await supabase.from(table).update(changes).eq('id', id).select();
  if (error) throw error;
  return data?.[0];
}

export async function remove(table, id) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}
