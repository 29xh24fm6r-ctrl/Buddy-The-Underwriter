/**
 * SPEC-13 — wizard write target.
 *
 * Replaces the legacy POST /credit-memo/overrides for the
 * MemoCompletionWizard. Maps the wizard's QualitativeOverrides keys
 * onto the canonical memo-input tables:
 *
 *   business_description           → deal_borrower_story.business_description
 *   revenue_mix                    → deal_borrower_story.revenue_model
 *   seasonality                    → deal_borrower_story.seasonality
 *   competitive_advantages         → deal_borrower_story.key_risks
 *   banker_summary                 → deal_borrower_story.banker_notes
 *   principal_bio_<owner-id>       → deal_management_profiles[<owner-id>].resume_summary,
 *                                    person_name from ownership_entities.display_name
 *
 * Bank-scoped via ensureDealBankAccess. Other keys (collateral_description,
 * tabs_viewed, etc.) are intentionally dropped here — collateral is owned
 * by deal_collateral_items via document extraction.
 */
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertBorrowerStory } from "@/lib/creditMemo/inputs/upsertBorrowerStory";
import { upsertManagementProfile } from "@/lib/creditMemo/inputs/upsertManagementProfile";

export const runtime = "nodejs";
export const maxDuration = 15;

const PRINCIPAL_BIO_PREFIX = "principal_bio_";

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await props.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: 403 },
      );
    }
    const bankId = access.bankId;

    const body = (await req.json().catch(() => ({}))) as {
      overrides?: Record<string, unknown>;
    };
    const overrides = body?.overrides ?? {};

    // ── Borrower-story patch ────────────────────────────────────────
    const businessDescription = asTrimmedString(overrides.business_description);
    const revenueModel = asTrimmedString(overrides.revenue_mix);
    const seasonality = asTrimmedString(overrides.seasonality);
    const competitiveAdvantages = asTrimmedString(
      overrides.competitive_advantages,
    );
    const bankerSummary = asTrimmedString(overrides.banker_summary);

    const storyPatch: Record<string, string | null> = {};
    if (businessDescription !== null) storyPatch.business_description = businessDescription;
    if (revenueModel !== null) storyPatch.revenue_model = revenueModel;
    if (seasonality !== null) storyPatch.seasonality = seasonality;
    if (competitiveAdvantages !== null) storyPatch.key_risks = competitiveAdvantages;
    if (bankerSummary !== null) storyPatch.banker_notes = bankerSummary;

    let borrowerStoryWritten = false;
    if (Object.keys(storyPatch).length > 0) {
      const out = await upsertBorrowerStory({
        dealId,
        patch: storyPatch,
        source: "banker",
        confidence: 1,
      });
      borrowerStoryWritten = out.ok;
    }

    // ── Management-profile patches ──────────────────────────────────
    const sb = supabaseAdmin();
    const { data: ownersRaw } = await (sb as any)
      .from("ownership_entities")
      .select("id, display_name")
      .eq("deal_id", dealId);
    const owners = (
      (ownersRaw ?? []) as Array<{ id: string; display_name: string | null }>
    ).reduce<Record<string, string>>((acc, row) => {
      acc[row.id] = (row.display_name ?? "").trim() || "Unknown";
      return acc;
    }, {});

    let managementWrites = 0;
    for (const [key, raw] of Object.entries(overrides)) {
      if (!key.startsWith(PRINCIPAL_BIO_PREFIX)) continue;
      const ownerId = key.slice(PRINCIPAL_BIO_PREFIX.length);
      const summary = asTrimmedString(raw);
      if (summary === null) continue;
      const personName = owners[ownerId] ?? "Unknown";
      const out = await upsertManagementProfile({
        dealId,
        patch: { person_name: personName, resume_summary: summary },
        source: "banker",
        confidence: 1,
      });
      if (out.ok) managementWrites += 1;
    }

    return NextResponse.json({
      ok: true,
      borrowerStoryWritten,
      managementWrites,
      bankId,
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    console.error("[memo-inputs/from-wizard POST]", e);
    return NextResponse.json(
      { ok: false, error: String(e) },
      { status: 500 },
    );
  }
}
