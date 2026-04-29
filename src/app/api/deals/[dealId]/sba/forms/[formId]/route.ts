import "server-only";

/**
 * Phase 7R Pass 2 — SBA Forms (consolidated)
 *
 * Replaces /api/deals/[dealId]/sba/forms/1919 and /forms/1920 with a single
 * parameterized route. New formIds (e.g. 912, 1244) add a switch case here
 * instead of a new directory.
 *
 * GET /api/deals/[dealId]/sba/forms/[formId]
 *   formId ∈ { "1919", "1920" }
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildSbaForm1919 } from "@/lib/sba/forms/build1919";
import { buildSbaForm1920 } from "@/lib/sba/forms/build1920";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { DealFinancialSnapshotV1 } from "@/lib/deals/financialSnapshotCore";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes need 60s for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; formId: string }> };

const SUPPORTED_FORMS = new Set(["1919", "1920"]);

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId, formId } = await ctx.params;

    if (!SUPPORTED_FORMS.has(formId)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported SBA form: ${formId}. Supported: 1919, 1920.` },
        { status: 400 },
      );
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    const { data: snapshotRow } = await sb
      .from("financial_snapshots")
      .select("id, snapshot_json")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!snapshotRow) {
      return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 404 });
    }

    const snapshot = snapshotRow.snapshot_json as DealFinancialSnapshotV1;

    if (formId === "1919") {
      const [{ data: decisionRow }, { data: deal }, { data: loanRequest }] = await Promise.all([
        sb
          .from("financial_snapshot_decisions")
          .select("sba_json")
          .eq("deal_id", dealId)
          .eq("bank_id", access.bankId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("deals")
          .select("*")
          .eq("id", dealId)
          .eq("bank_id", access.bankId)
          .maybeSingle(),
        sb
          .from("deal_loan_requests")
          .select("requested_amount, use_of_proceeds")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const eligibility = (decisionRow as { sba_json?: unknown } | null)?.sba_json
        ? ((decisionRow as { sba_json: unknown }).sba_json as Record<string, unknown>)
        : evaluateSbaEligibility({
            snapshot,
            borrowerEntityType: (deal as { entity_type?: string | null } | null)?.entity_type ?? null,
            useOfProceeds: Array.isArray((loanRequest as { use_of_proceeds?: unknown } | null)?.use_of_proceeds)
              ? ((loanRequest as { use_of_proceeds: unknown[] }).use_of_proceeds.filter(
                  (x): x is string => typeof x === "string",
                ))
              : null,
            dealType: (deal as { deal_type?: string | null } | null)?.deal_type ?? null,
            loanProductType:
              (loanRequest as { product_type?: string | null } | null)?.product_type ?? null,
          });

      const form = buildSbaForm1919({
        snapshot,
        borrowerName:
          (deal as { borrower_name?: string | null; name?: string | null } | null)?.borrower_name ??
          (deal as { name?: string | null } | null)?.name ??
          null,
        entityType: (deal as { entity_type?: string | null } | null)?.entity_type ?? null,
        loanAmount: (loanRequest as { requested_amount?: number | null } | null)?.requested_amount ?? null,
        useOfProceeds: Array.isArray(
          (loanRequest as { use_of_proceeds?: unknown } | null)?.use_of_proceeds,
        )
          ? (loanRequest as { use_of_proceeds: unknown[] }).use_of_proceeds.filter(
              (x): x is string => typeof x === "string",
            )
          : null,
        eligibility: eligibility as Parameters<typeof buildSbaForm1919>[0]["eligibility"],
      });

      await logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "sba_form_1919_built",
        uiState: "done",
        uiMessage: "SBA Form 1919 generated",
        meta: { missing: form.missing.length },
      });

      return NextResponse.json({ ok: true, dealId, form });
    }

    // formId === "1920"
    const [{ data: deal }, { data: loanRequest }] = await Promise.all([
      sb
        .from("deals")
        .select("*")
        .eq("id", dealId)
        .eq("bank_id", access.bankId)
        .maybeSingle(),
      sb
        .from("deal_loan_requests")
        .select("requested_amount")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const form = buildSbaForm1920({
      snapshot,
      borrowerName:
        (deal as { borrower_name?: string | null; name?: string | null } | null)?.borrower_name ??
        (deal as { name?: string | null } | null)?.name ??
        null,
      loanAmount: (loanRequest as { requested_amount?: number | null } | null)?.requested_amount ?? null,
    });

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "sba_form_1920_built",
      uiState: "done",
      uiMessage: "SBA Form 1920 generated",
      meta: { missing: form.missing.length },
    });

    return NextResponse.json({ ok: true, dealId, form });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/forms/[formId]]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
