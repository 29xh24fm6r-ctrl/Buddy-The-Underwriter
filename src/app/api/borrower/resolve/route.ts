import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimit } from "@/lib/portal/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token ?? "").trim();
  if (!token)
    return NextResponse.json(
      { ok: false, error: "missing_token" },
      { status: 400 },
    );

  // This endpoint reports whether a token is valid/expired/revoked with no
  // rate limit — usable to brute-force/probe token validity. Rate-limit
  // per caller IP as well as per token prefix, since an attacker probing
  // random tokens won't share a token prefix across requests.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = rateLimit(`borrower_resolve:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from("borrower_portal_links")
    .select("deal_id,expires_at,revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  if (!data)
    return NextResponse.json(
      { ok: false, error: "invalid_token" },
      { status: 404 },
    );
  if ((data as any).revoked_at)
    return NextResponse.json({ ok: false, error: "revoked" }, { status: 403 });
  if (
    (data as any).expires_at &&
    new Date((data as any).expires_at).getTime() < Date.now()
  )
    return NextResponse.json({ ok: false, error: "expired" }, { status: 403 });

  return NextResponse.json({ ok: true, dealId: (data as any).deal_id });
}
