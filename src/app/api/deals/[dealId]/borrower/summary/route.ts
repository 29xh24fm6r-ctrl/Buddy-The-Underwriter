import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { extractBorrowerFromDocs } from "@/lib/borrower/extractBorrowerFromDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, borrower_id, borrower_name")
      .eq("id", dealId)
      .eq("bank_id", access.bankId)
      .maybeSingle();

    if (dealError || !deal) {
      return NextResponse.json(
        { ok: false, error: dealError?.message ?? "deal_not_found" },
        { status: 404 },
      );
    }

    let borrower: any = null;
    if (deal.borrower_id) {
      const { data: b, error: bErr } = await sb
        .from("borrowers")
        .select("id, legal_name, entity_type, ein, primary_contact_name, primary_contact_email, extracted_confidence")
        .eq("id", deal.borrower_id)
        .eq("bank_id", access.bankId)
        .maybeSingle();

      if (!bErr) borrower = b ?? null;
    }

    // Check for owner attestation
    let hasAttestation = false;
    if (deal.borrower_id) {
      const { data: att } = await sb
        .from("borrower_owner_attestations")
        .select("id")
        .eq("borrower_id", deal.borrower_id)
        .order("attested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      hasAttestation = Boolean(att);
    }

    const { data: principals } = await sb
      .from("deal_entities")
      .select("id, name")
      .eq("deal_id", dealId)
      .eq("entity_kind", "PERSON")
      .order("created_at", { ascending: true })
      .limit(6);

    let suggestedBorrower: any = null;
    if (!borrower) {
      try {
        const extracted = await extractBorrowerFromDocs({
          dealId,
          bankId: access.bankId,
        });
        if (extracted?.legalName || extracted?.entityType) {
          suggestedBorrower = {
            legal_name: extracted.legalName ?? null,
            entity_type: extracted.entityType ?? null,
            ein: extracted.einMasked ?? null,
            address: extracted.address ?? null,
            state_of_formation: extracted.stateOfFormation ?? null,
            source_doc_id: extracted.sourceDocId ?? null,
            confidence: extracted.confidence ?? null,
          };
        }
      } catch (e) {
        console.warn("[borrower/summary] suggestion failed", e);
      }
    }

    return NextResponse.json({
      ok: true,
      borrower,
      principals: principals ?? [],
      dealBorrowerName: (deal as any)?.borrower_name ?? null,
      hasAttestation,
      suggestedBorrower,
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/borrower/summary]", error);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
