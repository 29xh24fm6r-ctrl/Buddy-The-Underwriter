import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "");
  if (!token) return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });

  const tokenHash = sha256(token);
  const sb = supabaseAdmin();

  const link = await sb
    .from("deal_upload_links")
    .select("id, deal_id, expires_at, revoked_at, single_use, used_at, requested_keys")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (link.error || !link.data) return NextResponse.json({ ok: false, error: "Invalid link" }, { status: 404 });

  const dealId = String(link.data.deal_id);

  const checklist = await sb
    .from("deal_checklist_items")
    .select("checklist_key, label, status, category")
    .eq("deal_id", dealId);

  if (checklist.error) return NextResponse.json({ ok: false, error: checklist.error.message }, { status: 500 });

  const items = checklist.data || [];
  const missing = items.filter((x: any) => x.status === "missing" || x.status === "requested");

  // If the link is scoped to requested_keys, only speak about those keys
  const requestedKeys: string[] = Array.isArray(link.data.requested_keys) ? link.data.requested_keys : [];
  const filteredMissing = requestedKeys.length
    ? missing.filter((m: any) => requestedKeys.includes(m.checklist_key))
    : missing;

  const nextItem = filteredMissing[0] || null;

  // Voice prompt is deterministic and can be spoken by OpenAI Realtime voice
  const prompt = nextItem
    ? `Next, please upload: ${nextItem.label}. When you're ready, select the file and hit Upload.`
    : `You're all set. I don't see any missing requested documents for this link.`;

  return NextResponse.json({
    ok: true,
    dealId,
    nextChecklistKey: nextItem?.checklist_key || null,
    nextLabel: nextItem?.label || null,
    prompt,
    progress: {
      total: items.length,
      remaining: filteredMissing.length,
      remainingKeys: filteredMissing.map((m: any) => m.checklist_key),
    },
  });
}
