import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ dealId: string }>;

// Only these columns may be inline-edited by the CCO via PATCH. Any other
// field name returns 400 — this keeps the PATCH endpoint from being used
// as a generic writer.
const EDITABLE_NARRATIVE_FIELDS = new Set<string>([
  "executive_summary",
  "industry_analysis",
  "marketing_strategy",
  "operations_plan",
  "swot_strengths",
  "swot_weaknesses",
  "swot_opportunities",
  "swot_threats",
  "sensitivity_narrative",
  "business_overview_narrative",
  "franchise_section",
]);

// ─── GET — latest package row for CCO review ─────────────────────────────────

export async function GET(_req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("deal_id", dealId)
      .order("version_number", { ascending: false, nullsFirst: false })
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "No SBA package generated for this deal yet." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, package: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── PUT — review workflow actions ───────────────────────────────────────────

export async function PUT(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as
      | "approve"
      | "request_changes"
      | "submit"
      | undefined;
    const notes = typeof body?.notes === "string" ? body.notes : null;

    if (action !== "approve" && action !== "request_changes" && action !== "submit") {
      return NextResponse.json(
        { ok: false, error: "action must be approve, request_changes, or submit" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Load the latest package for this deal (same ordering as GET).
    const { data: current, error: loadErr } = await sb
      .from("buddy_sba_packages")
      .select("id, status")
      .eq("deal_id", dealId)
      .order("version_number", { ascending: false, nullsFirst: false })
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (loadErr) {
      return NextResponse.json(
        { ok: false, error: loadErr.message },
        { status: 500 },
      );
    }
    if (!current) {
      return NextResponse.json(
        { ok: false, error: "No SBA package found for this deal." },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (action === "approve") {
      patch.status = "reviewed";
      patch.reviewed_at = now;
      if (notes) patch.reviewer_notes = notes;
    } else if (action === "request_changes") {
      patch.status = "revision_requested";
      patch.revision_requested_at = now;
      if (notes) patch.reviewer_notes = notes;
    } else if (action === "submit") {
      // Gate: must be reviewed first.
      if (current.status !== "reviewed") {
        return NextResponse.json(
          {
            ok: false,
            error: `Cannot submit from status "${current.status}". Approve the package first.`,
          },
          { status: 409 },
        );
      }
      patch.status = "submitted";
      patch.submitted_at = now;
    }

    const { error: upErr } = await sb
      .from("buddy_sba_packages")
      .update(patch)
      .eq("id", current.id);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: upErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, status: patch.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── PATCH — inline narrative edit ───────────────────────────────────────────

export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const field = body?.field as string | undefined;
    const value = body?.value;

    if (!field || typeof value !== "string") {
      return NextResponse.json(
        { ok: false, error: "field (string) and value (string) are required" },
        { status: 400 },
      );
    }
    if (!EDITABLE_NARRATIVE_FIELDS.has(field)) {
      return NextResponse.json(
        { ok: false, error: `Field "${field}" is not inline-editable.` },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Target the latest package for this deal.
    const { data: current, error: loadErr } = await sb
      .from("buddy_sba_packages")
      .select("id")
      .eq("deal_id", dealId)
      .order("version_number", { ascending: false, nullsFirst: false })
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (loadErr) {
      return NextResponse.json(
        { ok: false, error: loadErr.message },
        { status: 500 },
      );
    }
    if (!current) {
      return NextResponse.json(
        { ok: false, error: "No SBA package found for this deal." },
        { status: 404 },
      );
    }

    const { error: upErr } = await sb
      .from("buddy_sba_packages")
      .update({ [field]: value })
      .eq("id", current.id);

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: upErr.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, field });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
