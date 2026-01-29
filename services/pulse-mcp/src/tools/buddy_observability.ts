import { supabaseAdmin } from "../supabase";

export async function buddy_list_recent_errors(args: { minutes?: number; env?: string }) {
  const minutes = args.minutes ?? 60;
  const env = args.env ?? null;
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  let q = supabaseAdmin
    .from("buddy_observer_events")
    .select("*")
    .gte("created_at", since)
    .in("severity", ["error", "fatal"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (env) q = q.eq("env", env);
  return await q;
}

export async function buddy_get_deal_timeline(args: { deal_id: string }) {
  return await supabaseAdmin
    .from("buddy_observer_events")
    .select("*")
    .eq("deal_id", args.deal_id)
    .order("created_at", { ascending: true })
    .limit(2000);
}

export async function buddy_get_deal_state(args: { deal_id: string }) {
  return await supabaseAdmin
    .from("buddy_deal_state")
    .select("*")
    .eq("deal_id", args.deal_id)
    .maybeSingle();
}

export async function buddy_list_stuck_deals(args: { env?: string; stage?: string; idleMinutes?: number }) {
  const env = args.env ?? "prod";
  const idleMinutes = args.idleMinutes ?? 60 * 24;
  const cutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();

  let q = supabaseAdmin
    .from("buddy_deal_state")
    .select("*")
    .eq("env", env)
    .lt("last_event_at", cutoff)
    .order("last_event_at", { ascending: true })
    .limit(200);

  if (args.stage) q = q.eq("current_stage", args.stage);
  return await q;
}

export async function buddy_list_incidents(args: { env?: string; status?: string }) {
  const env = args.env ?? "prod";
  const status = args.status ?? "open";

  return await supabaseAdmin
    .from("buddy_incidents")
    .select("*")
    .eq("env", env)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);
}

/**
 * Phase C: Fingerprint clustering summary (fast, low-cost)
 * Calls RPC: public.buddy_error_fingerprint_summary
 */
export async function buddy_error_fingerprint_summary(args: {
  env?: string;
  minutes?: number;
  limit?: number;
}) {
  const env = args.env ?? "prod";
  const minutes = args.minutes ?? 60;
  const limit = args.limit ?? 10;

  return await supabaseAdmin.rpc("buddy_error_fingerprint_summary", {
    p_env: env,
    p_minutes: minutes,
    p_limit: limit,
  });
}

/**
 * Companion tool: fetch concrete samples for a fingerprint cluster
 */
export async function buddy_get_fingerprint_samples(args: {
  fingerprint: string;
  env?: string;
  minutes?: number;
  limit?: number;
}) {
  const env = args.env ?? "prod";
  const minutes = args.minutes ?? 240;
  const limit = args.limit ?? 50;
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  return await supabaseAdmin
    .from("buddy_observer_events")
    .select("*")
    .eq("env", env)
    .eq("fingerprint", args.fingerprint)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
}

