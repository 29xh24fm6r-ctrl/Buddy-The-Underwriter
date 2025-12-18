import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowIso() {
  return new Date().toISOString();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const dealId = parts[parts.indexOf("deals") + 1];

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await sb
    .from("deal_outbound_settings")
    .select("deal_id,mode,auto_send,throttle_minutes,sla_minutes,to_email,from_email")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Lazy default row
  if (!data) {
    const seed = {
      deal_id: dealId,
      mode: "copy",
      auto_send: false,
      throttle_minutes: 240,
      sla_minutes: 60,
      to_email: null,
      from_email: null,
      updated_at: nowIso(),
    };
    const { error: insErr } = await sb.from("deal_outbound_settings").insert(seed);
    if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, settings: seed });
  }

  return NextResponse.json({ ok: true, settings: data });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const dealId = parts[parts.indexOf("deals") + 1];

  const body = await req.json().catch(() => ({}));

  const mode = body?.mode === "system" ? "system" : "copy";
  const auto_send = Boolean(body?.auto_send ?? false);
  const throttle_minutes = Number(body?.throttle_minutes ?? 240);
  const to_email = body?.to_email ? String(body.to_email) : null;
  const from_email = body?.from_email ? String(body.from_email) : null;

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { error } = await sb
    .from("deal_outbound_settings")
    .upsert(
      {
        deal_id: dealId,
        mode,
        auto_send,
        throttle_minutes,
        updated_at: nowIso(),
        to_email,
        from_email,
      },
      { onConflict: "deal_id" }
    );

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
