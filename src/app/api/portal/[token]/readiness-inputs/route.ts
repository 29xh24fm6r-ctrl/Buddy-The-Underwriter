import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";
import { listChecklist } from "@/lib/portal/checklist";
import { evaluateBorrowerCompleteness } from "@/lib/borrower/borrowerCompleteness";
import {
  computeOwnershipReadiness,
  computeSbaFormsReadiness,
} from "@/lib/borrower/computeReadinessInputs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/portal/[token]/readiness-inputs
 *
 * Supplies Buddy's Lender Readiness Score with real profile, ownership, and
 * SBA-forms data — replacing the hardcoded stubs previously passed from
 * PortalClient. Read-only. Returns only the minimum aggregate counts/flags
 * needed to compute and explain the score — no raw borrower records, owner
 * PII, document contents, or file paths.
 *
 * Auth mirrors /api/portal/[token]/checklist exactly: token -> deal_id via
 * borrower_portal_links, falling back to borrower_invites via
 * resolveBorrowerToken. No id is ever accepted as a request parameter —
 * everything downstream is scoped from what the token itself resolves to.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const sb = supabaseAdmin();

    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    let dealId: string | null = link?.deal_id ?? null;
    if (!link) {
      try {
        dealId = (await resolveBorrowerToken(token)).deal_id;
      } catch {
        return NextResponse.json(
          { ok: false, error: "Invalid or expired link" },
          { status: 403 },
        );
      }
    } else if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: "Link expired" }, { status: 403 });
    }

    if (!dealId) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // Resolve borrower/bank strictly server-side from the token-resolved
    // deal — never accepted as client input.
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, borrower_id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal || !deal.borrower_id || !deal.bank_id) {
      return NextResponse.json(
        { ok: false, error: "Invalid or expired link" },
        { status: 403 },
      );
    }

    // --- Profile + ownership: shared evaluator, single source of truth ---
    const completeness = await evaluateBorrowerCompleteness({
      borrowerId: deal.borrower_id,
      bankId: deal.bank_id,
    });
    const ownership = computeOwnershipReadiness(completeness);

    // --- SBA forms: same document/checklist classification the borrower
    // already sees, not a second definition of "sba form" ---
    const checklistRows = await listChecklist(dealId);
    const { data: uploadRows } = await sb
      .from("deal_uploads")
      .select("checklist_key, status")
      .eq("deal_id", dealId);
    const sbaForms = computeSbaFormsReadiness(checklistRows, uploadRows ?? []);

    return NextResponse.json({
      ok: true,
      profile: {
        fieldsRequired: completeness.stats.fields_required,
        fieldsPresent: completeness.stats.fields_present,
        missingFields: completeness.profile_missing_fields,
      },
      ownership,
      sbaForms,
    });
  } catch (err: any) {
    console.error("[portal/readiness-inputs] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
