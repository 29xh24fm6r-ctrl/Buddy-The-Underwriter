import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRoleApi(["super_admin"]);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    throw e;
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("lender_programs")
    .select(
      "id, bank_id, lender_name, program_name, min_dscr, max_ltv, asset_types, geography, sba_only, score_threshold, notes, created_at, updated_at",
    )
    .order("lender_name", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, programs: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    await requireRoleApi(["super_admin"]);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: 403 });
    }
    throw e;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const required = ["bank_id", "lender_name"] as const;
  for (const k of required) {
    if (!body[k] || typeof body[k] !== "string") {
      return NextResponse.json(
        { ok: false, error: `missing_field:${k}` },
        { status: 400 },
      );
    }
  }

  const sb = supabaseAdmin();
  const { data: bank, error: bankErr } = await sb
    .from("banks")
    .select("id, bank_kind")
    .eq("id", body.bank_id)
    .maybeSingle();
  if (bankErr || !bank) {
    return NextResponse.json({ ok: false, error: "bank_not_found" }, { status: 404 });
  }
  if (bank.bank_kind !== "commercial_bank") {
    return NextResponse.json(
      { ok: false, error: "bank_kind_must_be_commercial_bank" },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from("lender_programs")
    .insert({
      bank_id: body.bank_id,
      lender_name: body.lender_name,
      program_name: body.program_name ?? null,
      min_dscr: body.min_dscr ?? null,
      max_ltv: body.max_ltv ?? null,
      asset_types: body.asset_types ?? null,
      geography: body.geography ?? null,
      sba_only: body.sba_only ?? false,
      score_threshold: body.score_threshold ?? null,
      notes: body.notes ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
