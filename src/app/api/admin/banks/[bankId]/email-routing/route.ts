import "server-only";

import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

function authzError(err: any) {
  const msg = String(err?.message ?? err);
  if (msg === "unauthorized")
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (msg === "forbidden")
    return { status: 403, body: { ok: false, error: "forbidden" } };
  return null;
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ bankId: string }> }
) {
  try {
    await requireSuperAdmin();
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }

  const { bankId } = await context.params;
  if (!bankId)
    return NextResponse.json(
      { ok: false, error: "bankId is required" },
      { status: 400 },
    );

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bank_email_routing")
    .select("contact_to_email,outbound_from_email,reply_to_mode,configured_reply_to_email,is_enabled,updated_at")
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  return NextResponse.json({ ok: true, routing: data ?? null });
}

type UpsertPayload = {
  contact_to_email: string;
  outbound_from_email: string;
  reply_to_mode?: "submitter" | "configured";
  configured_reply_to_email?: string | null;
  is_enabled?: boolean;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ bankId: string }> }
) {
  try {
    await requireSuperAdmin();
  } catch (err: any) {
    const a = authzError(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 },
    );
  }

  const { bankId } = await context.params;
  if (!bankId)
    return NextResponse.json(
      { ok: false, error: "bankId is required" },
      { status: 400 },
    );

  let body: UpsertPayload;
  try {
    body = (await req.json()) as UpsertPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (!body.contact_to_email?.trim())
    return NextResponse.json(
      { ok: false, error: "contact_to_email is required" },
      { status: 400 },
    );
  if (!body.outbound_from_email?.trim())
    return NextResponse.json(
      { ok: false, error: "outbound_from_email is required" },
      { status: 400 },
    );

  const sb = supabaseAdmin();

  const payload = {
    bank_id: bankId,
    contact_to_email: body.contact_to_email.trim(),
    outbound_from_email: body.outbound_from_email.trim(),
    reply_to_mode: body.reply_to_mode ?? "submitter",
    configured_reply_to_email: body.configured_reply_to_email ?? null,
    is_enabled: body.is_enabled ?? true,
  };

  const { error } = await sb
    .from("bank_email_routing")
    .upsert(payload, { onConflict: "bank_id" });

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  return NextResponse.json({ ok: true });
}
