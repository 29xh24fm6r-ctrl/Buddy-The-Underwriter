import "server-only";

/**
 * Aggregation route for SbaSigningPanel (SPEC S3 C-1) — not separately
 * spec'd by name, but the panel needs owner + IAL2 + per-form signature
 * status in one call. Same judgment-boundary pattern as S2's addendum
 * ("add a separate fetch... calling the route directly").
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import { buildForm1919Input } from "@/lib/sba/forms/form1919/inputBuilder";
import { FORM_912_TRIGGER_FIELDS } from "@/lib/sba/forms/form1919/fields";
import { buildForm155Input } from "@/lib/sba/forms/form155/inputBuilder";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/** SPEC S4 H-2 — extended from {1919, 413} to all 5 per-signer forms. */
const TRACKED_FORMS = ["FORM_1919", "FORM_413", "FORM_912", "FORM_4506C"] as const;

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

function personTriggers912(fields: Record<string, unknown>): boolean {
  return FORM_912_TRIGGER_FIELDS.some((key) => fields[key] === true);
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId, bankId } = await assertDealAccess(rawDealId);

    const sb = supabaseAdmin();

    const { data: owners } = await sb
      .from("ownership_entities")
      .select("id, entity_type, display_name, ownership_pct")
      .eq("deal_id", dealId);

    const { data: verifications } = await sb
      .from("borrower_identity_verifications")
      .select("ownership_entity_id, status, completed_at, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    const { data: signedDocs } = await sb
      .from("signed_documents")
      .select("signer_ownership_entity_id, form_code, expires_at, signature_completed_at")
      .eq("deal_id", dealId);

    const individualOwners = ((owners ?? []) as Array<Record<string, any>>).filter((o) => isIndividual(o.entity_type));

    // SPEC S4 H-2: FORM_912 is conditional per-owner (only triggering
    // owners need it) — reuse the same 1919-answer evaluation form912's
    // own inputBuilder uses, so this panel and the actual generator never
    // disagree about who's applicable.
    const form1919Input = await buildForm1919Input(dealId, sb);
    const triggering912Ids = new Set(
      form1919Input.sectionII.filter((p) => personTriggers912(p.fields)).map((p) => p.ownership_entity_id),
    );

    const rows = individualOwners.map((owner) => {
      const latestVerification = (verifications ?? []).find((v: any) => v.ownership_entity_id === owner.id) ?? null;
      const ial2Status: "verified" | "pending" | "declined" | "not_started" = !latestVerification
        ? "not_started"
        : ["completed", "approved"].includes(latestVerification.status)
          ? "verified"
          : ["declined", "failed", "expired"].includes(latestVerification.status)
            ? "declined"
            : "pending";

      const forms: Record<string, { signed: boolean; expiresAt: string | null; applicable: boolean }> = {};
      for (const formCode of TRACKED_FORMS) {
        const doc = (signedDocs ?? []).find(
          (d: any) => d.signer_ownership_entity_id === owner.id && d.form_code === formCode,
        );
        forms[formCode] = {
          signed: Boolean(doc) && (!doc?.expires_at || new Date(doc.expires_at) > new Date()),
          expiresAt: doc?.expires_at ?? null,
          applicable: formCode === "FORM_912" ? triggering912Ids.has(owner.id) : true,
        };
      }

      return {
        ownershipEntityId: owner.id,
        displayName: owner.display_name,
        ial2Status,
        forms,
      };
    });

    // SPEC S4 H-2: FORM_155/FORM_159 are deal-level (one instance total,
    // not one per owner) — surfaced separately rather than forced into the
    // per-owner grid.
    const form155Result = await buildForm155Input(dealId, bankId, sb);
    const { data: latestLoanRequest } = await sb
      .from("deal_loan_requests")
      .select("agent_used")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const dealLevelForms = [
      {
        formCode: "FORM_155",
        label: "Form 155 (Standby Creditor's Agreement)",
        applicable: form155Result.applicable,
        signed: false,
        ownershipEntityId: form155Result.applicable ? form155Result.borrower_ownership_entity_id : null,
      },
      {
        formCode: "FORM_159",
        label: "Form 159 (Fee Disclosure)",
        applicable: Boolean(latestLoanRequest?.agent_used),
        signed: false,
        ownershipEntityId: null,
      },
    ];

    if (form155Result.applicable && form155Result.borrower_ownership_entity_id) {
      const doc = (signedDocs ?? []).find(
        (d: any) => d.signer_ownership_entity_id === form155Result.borrower_ownership_entity_id && d.form_code === "FORM_155",
      );
      dealLevelForms[0].signed = Boolean(doc) && (!doc?.expires_at || new Date(doc.expires_at) > new Date());
    }

    return NextResponse.json({ ok: true, rows, dealLevelForms });
  } catch (e: unknown) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    console.error("[/api/deals/[dealId]/sba/signing-status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
