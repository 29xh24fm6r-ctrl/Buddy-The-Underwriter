import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

async function requireBankId(): Promise<string> {
  try {
    return await getCurrentBankId();
  } catch (err: any) {
    throw new Error(`Missing bank_id: ${err?.message || "tenant resolution failed"}`);
  }
}

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch {
    return json(403, { ok: false, error: "Forbidden" });
  }

  let bankId: string;
  try {
    bankId = await requireBankId();
  } catch (err: any) {
    return json(400, { ok: false, error: err?.message || "Missing tenant id" });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("tenant_email_routing")
    .select(
      "contact_to_email,outbound_from_email,reply_to_mode,configured_reply_to_email,is_enabled,updated_at"
    )
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true, routing: data ?? null });
}

type UpsertPayload = {
  contact_to_email: string;
  outbound_from_email: string;
  reply_to_mode?: "submitter" | "configured";
  configured_reply_to_email?: string | null;
  is_enabled?: boolean;
};

export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
  } catch {
    return json(403, { ok: false, error: "Forbidden" });
  }

  let bankId: string;
  try {
    bankId = await requireBankId();
  } catch (err: any) {
    return json(400, { ok: false, error: err?.message || "Missing tenant id" });
  }

  let body: UpsertPayload;
  try {
    body = (await req.json()) as UpsertPayload;
  } catch {
    return json(400, { ok: false, error: "Invalid JSON" });
  }

  if (!body.contact_to_email?.trim())
    return json(400, { ok: false, error: "contact_to_email is required" });
  if (!body.outbound_from_email?.trim())
    return json(400, { ok: false, error: "outbound_from_email is required" });

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
    .from("tenant_email_routing")
    .upsert(payload, { onConflict: "bank_id" });

  if (error) return json(500, { ok: false, error: error.message });
  return json(200, { ok: true });
}
