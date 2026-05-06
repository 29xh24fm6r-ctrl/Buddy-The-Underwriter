/**
 * PATCH /api/deals/[dealId]/overrides/[overrideId]
 *
 * SPEC-06 — banker inline-edits an override's reason / justification /
 * severity. Reviewing flips `requires_review` via the dedicated /review
 * sub-route.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { writeDealEvent } from "@/lib/events/dealEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set([
  "reason",
  "justification",
  "severity",
  // SPEC-07: needed to support "undo mark reviewed" — flips requires_review
  // back to true. The dedicated /review POST handler stays as the canonical
  // monotonic-to-false path; PATCH covers the bidirectional case.
  "requires_review",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; overrideId: string }> },
) {
  const { dealId, overrideId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    update[k] = typeof v === "string" ? v.trim() : v;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_updatable_fields" },
      { status: 400 },
    );
  }

  const { data: existing, error: fetchErr } = await sb
    .from("decision_overrides")
    .select("id, deal_id")
    .eq("id", overrideId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: fetchErr.message },
      { status: 500 },
    );
  }
  if (!existing || existing.deal_id !== dealId) {
    return NextResponse.json(
      { ok: false, error: "override_not_found" },
      { status: 404 },
    );
  }

  const { data, error } = await sb
    .from("decision_overrides")
    .update(update)
    .eq("id", overrideId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  try {
    await writeDealEvent({
      dealId,
      bankId,
      kind: "override.edited",
      payload: { overrideId, fields: Object.keys(update), source: "stage_cockpit" },
    });
  } catch {
    // best-effort audit log
  }

  return NextResponse.json({ ok: true, override: data });
}
