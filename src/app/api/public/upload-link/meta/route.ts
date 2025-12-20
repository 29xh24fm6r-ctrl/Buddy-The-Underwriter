// src/app/api/public/upload-link/meta/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  }

  const tokenHash = sha256(token);

  const { data, error } = await supabaseAdmin()
    .from("deal_upload_links")
    .select("id, deal_id, label, require_password, expires_at, revoked_at, single_use, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "Invalid link." }, { status: 404 });
  }

  const now = Date.now();
  const expiresAt = new Date(data.expires_at).getTime();
  const revoked = !!data.revoked_at;
  const used = !!data.used_at;

  if (revoked) {
    return NextResponse.json({ ok: false, error: "Link revoked." }, { status: 403 });
  }
  if (expiresAt < now) {
    return NextResponse.json({ ok: false, error: "Link expired." }, { status: 403 });
  }
  if (data.single_use && used) {
    return NextResponse.json({ ok: false, error: "Link already used." }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    dealId: data.deal_id,
    label: data.label,
    requirePassword: data.require_password,
    expiresAt: data.expires_at,
  });
}
