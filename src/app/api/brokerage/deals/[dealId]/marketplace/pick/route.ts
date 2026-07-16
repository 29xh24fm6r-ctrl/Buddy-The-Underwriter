import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/marketplace/pick   body: { claimId }
 *
 * The borrower picks the lender they want. Cookie-authed via getBorrowerSession;
 * session.deal_id must match [dealId] or 404 (same invariant as other brokerage
 * routes). Records the pick, grants the winning lender full package access,
 * withdraws the other active claims, flips the listing to `picked`, and queues the
 * borrower_selected_lender + package_access_granted lender messages.
 *
 * Also generates the FINAL (unwatermarked, full-detail) trident bundle and
 * freezes its paths onto buddy_sealed_packages.final_* — this is the missing
 * half of the sealing/pick design (see specs/brokerage/sprint-05-sealing-and-kfs.md's
 * "Storage paths for final-mode PDFs (generated at pick, not seal)" comment on
 * those columns, and sprint-06's runAtomicUnlock). Without this, the package
 * manifest could only ever fall back to whatever the LIVE (possibly stale,
 * possibly still-preview) trident bundle happens to be, never a frozen
 * snapshot of what the winning lender was actually shown at pick time.
 *
 * generateTridentBundle MUST be awaited, never fire-and-forget — see
 * src/lib/brokerage/trident/__tests__/awaitGenerationGuard.test.ts. A bundle
 * row left in `running` because the serverless function was reclaimed before
 * completion is a stuck-forever row, not a retryable one. maxDuration is set
 * to 300s to match every other synchronous trident-generation call site.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { generateTridentBundle } from "@/lib/brokerage/trident/generateTridentBundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;

  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const claimId = typeof body?.claimId === "string" ? body.claimId : null;
  if (!claimId) {
    return NextResponse.json({ ok: false, error: "missing_claim" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // The deal's listing must be open for a pick (a lender has claimed).
  const { data: listing } = await sb
    .from("marketplace_listings")
    .select("id, sealed_package_id, status")
    .eq("deal_id", dealId)
    .in("status", ["awaiting_borrower_pick", "claiming"])
    .maybeSingle();
  if (!listing) {
    return NextResponse.json({ ok: false, error: "not_pickable" }, { status: 400 });
  }

  // The claim must belong to this listing and still be active.
  const { data: claim } = await sb
    .from("marketplace_claims")
    .select("id, listing_id, lender_bank_id, status")
    .eq("id", claimId)
    .maybeSingle();
  if (
    !claim ||
    (claim as any).listing_id !== (listing as any).id ||
    (claim as any).status !== "active"
  ) {
    return NextResponse.json({ ok: false, error: "invalid_claim" }, { status: 400 });
  }

  const listingId = (listing as any).id;
  const lenderBankId = (claim as any).lender_bank_id;
  const nowIso = new Date().toISOString();

  const { data: pick, error: pickErr } = await sb
    .from("marketplace_picks")
    .insert({
      listing_id: listingId,
      deal_id: dealId,
      claim_id: claimId,
      picked_lender_bank_id: lenderBankId,
      status: "picked",
      borrower_selected_at: nowIso,
    })
    .select("id")
    .single();
  if (pickErr || !pick) {
    return NextResponse.json(
      { ok: false, error: "pick_insert_failed", detail: pickErr?.message },
      { status: 500 },
    );
  }

  // Winning claim stays 'active'; the other active claims are withdrawn.
  await sb
    .from("marketplace_listings")
    .update({ status: "picked", picked_at: nowIso, updated_at: nowIso })
    .eq("id", listingId);
  await sb
    .from("marketplace_claims")
    .update({ status: "withdrawn" })
    .eq("listing_id", listingId)
    .eq("status", "active")
    .neq("id", claimId);

  // Grant the picked lender full package access.
  const { data: access } = await sb
    .from("marketplace_package_access")
    .insert({
      listing_id: listingId,
      claim_id: claimId,
      deal_id: dealId,
      lender_bank_id: lenderBankId,
      sealed_package_id: (listing as any).sealed_package_id,
      access_level: "full",
      granted_at: nowIso,
    })
    .select("id")
    .single();

  // Generate the FINAL trident bundle and freeze its paths onto the sealed
  // package. Best-effort: a generation failure must not fail the pick itself
  // (the pick + access grant above already succeeded and must stand) — the
  // package manifest's existing fallback to the live trident bundle covers
  // the gap until generation is retried (e.g. via the admin-only
  // /trident/generate route with mode=final).
  try {
    const finalBundle = await generateTridentBundle({ dealId, mode: "final" });
    if (finalBundle.ok && (listing as any).sealed_package_id) {
      await sb
        .from("buddy_sealed_packages")
        .update({
          final_business_plan_path: finalBundle.paths.businessPlanPdf,
          // Final mode produces only the XLSX workbook, not a redacted
          // summary PDF (that's preview-only) — this column holds whichever
          // artifact final mode actually produces.
          final_projections_path: finalBundle.paths.projectionsXlsx,
          final_feasibility_path: finalBundle.paths.feasibilityPdf,
        })
        .eq("id", (listing as any).sealed_package_id);
    } else if (!finalBundle.ok) {
      console.warn("[marketplace/pick] final trident bundle generation failed (non-fatal)", {
        dealId,
        listingId,
        error: finalBundle.error,
      });
      await sb.from("marketplace_audit_log").insert({
        deal_id: dealId,
        listing_id: listingId,
        actor_bank_id: null,
        actor_scope: "system",
        action: "final_bundle_generation_failed",
        metadata: {
          pickId: (pick as any).id,
          error: finalBundle.error,
        },
        created_at: nowIso,
      });
    }
  } catch (err) {
    console.warn("[marketplace/pick] final trident bundle generation threw (non-fatal)", {
      dealId,
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Notify the picked lender (best-effort, non-fatal).
  try {
    const { queueLenderMessage } = await import("@/lib/brokerage/lenderComms");
    await queueLenderMessage(
      "borrower_selected_lender",
      { dealId, listingId, claimId, lenderBankId, stage: "picked" },
      "email",
      sb,
    );
    await queueLenderMessage(
      "package_access_granted",
      { dealId, listingId, claimId, lenderBankId, accessId: (access as any)?.id, stage: "picked" },
      "email",
      sb,
    );
  } catch (err) {
    console.warn("[marketplace/pick] lender comms failed (non-fatal)", {
      dealId,
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Prepare (not generate — that needs official SBA templates ingested,
  // a separate environmental blocker) the borrower's per-owner SBA form
  // package now that a lender is chosen (best-effort, non-fatal). Ticket
  // 2's default sequencing decision: e-signature happens after pick, so
  // the forms it will need should already exist by then rather than being
  // built lazily the first time someone opens a signing screen.
  try {
    const { prepareBrokerageSbaForms } = await import("@/lib/brokerage/borrowerFormsOrchestration");
    await prepareBrokerageSbaForms(dealId, sb);
  } catch (err) {
    console.warn("[marketplace/pick] sba form-package prepare failed (non-fatal)", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    ok: true,
    pickId: (pick as any).id,
    accessId: (access as any)?.id ?? null,
    pickedLenderBankId: lenderBankId,
  });
}
