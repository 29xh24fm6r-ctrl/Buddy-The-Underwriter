import "server-only";

/**
 * Aggregation route for SbaSigningPanel (SPEC S3 C-1) — not separately
 * spec'd by name, but the panel needs owner + IAL2 + per-form signature
 * status in one call. Same judgment-boundary pattern as S2's addendum
 * ("add a separate fetch... calling the route directly").
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const TRACKED_FORMS = ["FORM_1919", "FORM_413"] as const;

function isIndividual(entityType: string | null | undefined): boolean {
  return entityType === "individual" || entityType === "person";
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId: rawDealId } = await ctx.params;
    const { dealId } = await requireDealAccess(rawDealId);

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

    const rows = individualOwners.map((owner) => {
      const latestVerification = (verifications ?? []).find((v: any) => v.ownership_entity_id === owner.id) ?? null;
      const ial2Status: "verified" | "pending" | "declined" | "not_started" = !latestVerification
        ? "not_started"
        : ["completed", "approved"].includes(latestVerification.status)
          ? "verified"
          : ["declined", "failed", "expired"].includes(latestVerification.status)
            ? "declined"
            : "pending";

      const forms: Record<string, { signed: boolean; expiresAt: string | null }> = {};
      for (const formCode of TRACKED_FORMS) {
        const doc = (signedDocs ?? []).find(
          (d: any) => d.signer_ownership_entity_id === owner.id && d.form_code === formCode,
        );
        forms[formCode] = {
          signed: Boolean(doc) && (!doc?.expires_at || new Date(doc.expires_at) > new Date()),
          expiresAt: doc?.expires_at ?? null,
        };
      }

      return {
        ownershipEntityId: owner.id,
        displayName: owner.display_name,
        ial2Status,
        forms,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[/api/deals/[dealId]/sba/signing-status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
