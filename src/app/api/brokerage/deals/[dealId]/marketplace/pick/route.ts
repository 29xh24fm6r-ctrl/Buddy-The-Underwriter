import "server-only";

/**
 * POST /api/brokerage/deals/[dealId]/marketplace/pick   body: { claimId }
 *
 * The borrower selection is irreversible, so this route is deliberately
 * retryable and fail-closed. A success response proves the pick, listing
 * transition, losing-claim withdrawal, sealed artifact binding, lender access,
 * canonical audit evidence, and lender notification outbox rows all exist.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { assertNotTestDeal } from "@/lib/qaIdentity/isolation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DbError = { message?: string } | null | undefined;

function failure(
  error: string,
  status: number,
  detail?: DbError | string,
): NextResponse {
  const message =
    typeof detail === "string" ? detail : detail?.message;
  return NextResponse.json(
    { ok: false, error, ...(message ? { detail: message } : {}) },
    { status },
  );
}

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
    return failure("missing_claim", 400);
  }

  const sb = supabaseAdmin();

  try {
    await assertNotTestDeal(dealId, sb);
  } catch {
    return failure("test_application_distribution_blocked", 403);
  }

  // Include `picked` so a request interrupted after one of the writes can
  // safely resume and prove every remaining side effect.
  const { data: listing, error: listingError } = await sb
    .from("marketplace_listings")
    .select("id, sealed_package_id, status")
    .eq("deal_id", dealId)
    .in("status", ["awaiting_borrower_pick", "claiming", "picked"])
    .maybeSingle();
  if (listingError) return failure("listing_read_failed", 503, listingError);
  if (!listing) return failure("not_pickable", 400);

  const { data: claim, error: claimError } = await sb
    .from("marketplace_claims")
    .select("id, listing_id, lender_bank_id, status")
    .eq("id", claimId)
    .maybeSingle();
  if (claimError) return failure("claim_read_failed", 503, claimError);
  if (
    !claim ||
    String(claim.listing_id) !== String(listing.id) ||
    claim.status !== "active"
  ) {
    return failure("invalid_claim", 400);
  }

  const listingId = String(listing.id);
  const lenderBankId = String(claim.lender_bank_id);
  const sealedPackageId = listing.sealed_package_id
    ? String(listing.sealed_package_id)
    : null;
  if (!sealedPackageId) {
    return failure("sealed_package_required", 409);
  }

  // Bind and prove the immutable artifacts before recording an irreversible
  // pick. Historical packages may be backfilled only from the snapshot they
  // were sealed with; live bundle paths are never substituted here.
  const { data: sealed, error: sealedError } = await sb
    .from("buddy_sealed_packages")
    .select(
      "id, sealed_snapshot, final_business_plan_path, final_projections_path, final_feasibility_path",
    )
    .eq("id", sealedPackageId)
    .eq("deal_id", dealId)
    .is("unsealed_at", null)
    .maybeSingle();
  if (sealedError) return failure("sealed_package_read_failed", 503, sealedError);
  if (!sealed) return failure("sealed_package_unavailable", 409);

  const artifacts = (sealed.sealed_snapshot?.tridentFinal?.artifacts ?? null) as {
    businessPlan?: string | null;
    projectionsXlsx?: string | null;
    feasibility?: string | null;
  } | null;
  const boundArtifacts = {
    final_business_plan_path:
      sealed.final_business_plan_path ?? artifacts?.businessPlan ?? null,
    final_projections_path:
      sealed.final_projections_path ?? artifacts?.projectionsXlsx ?? null,
    final_feasibility_path:
      sealed.final_feasibility_path ?? artifacts?.feasibility ?? null,
  };
  const missingArtifacts = Object.entries(boundArtifacts)
    .filter(([, path]) => !path)
    .map(([column]) => column);
  if (missingArtifacts.length > 0) {
    return NextResponse.json(
      { ok: false, error: "sealed_package_artifacts_incomplete", missing: missingArtifacts },
      { status: 409 },
    );
  }

  const needsArtifactBackfill =
    !sealed.final_business_plan_path ||
    !sealed.final_projections_path ||
    !sealed.final_feasibility_path;
  if (needsArtifactBackfill) {
    const { data: rebound, error: backfillError } = await sb
      .from("buddy_sealed_packages")
      .update(boundArtifacts)
      .eq("id", sealedPackageId)
      .eq("deal_id", dealId)
      .is("unsealed_at", null)
      .select(
        "id, final_business_plan_path, final_projections_path, final_feasibility_path",
      )
      .maybeSingle();
    if (backfillError || !rebound) {
      return failure("sealed_package_binding_failed", 503, backfillError);
    }
    if (
      rebound.final_business_plan_path !== boundArtifacts.final_business_plan_path ||
      rebound.final_projections_path !== boundArtifacts.final_projections_path ||
      rebound.final_feasibility_path !== boundArtifacts.final_feasibility_path
    ) {
      return failure("sealed_package_binding_unproven", 503);
    }
  }

  const nowIso = new Date().toISOString();

  // Unique(listing_id) makes the initial insert concurrency-safe. The read
  // makes retries idempotent and rejects a different claim after selection.
  const { data: existingPick, error: existingPickError } = await sb
    .from("marketplace_picks")
    .select("id, claim_id, picked_lender_bank_id, status, borrower_selected_at")
    .eq("listing_id", listingId)
    .eq("deal_id", dealId)
    .in("status", ["pending", "picked"])
    .maybeSingle();
  if (existingPickError) return failure("pick_read_failed", 503, existingPickError);
  if (existingPick && String(existingPick.claim_id) !== claimId) {
    return failure("different_claim_already_picked", 409);
  }

  let pick = existingPick;
  if (!pick) {
    const { data: insertedPick, error: pickError } = await sb
      .from("marketplace_picks")
      .insert({
        listing_id: listingId,
        deal_id: dealId,
        claim_id: claimId,
        picked_lender_bank_id: lenderBankId,
        status: "picked",
        borrower_selected_at: nowIso,
      })
      .select("id, claim_id, picked_lender_bank_id, status, borrower_selected_at")
      .single();
    if (pickError || !insertedPick) {
      return failure("pick_insert_failed", 503, pickError);
    }
    pick = insertedPick;
  }
  if (
    pick.status !== "picked" ||
    String(pick.picked_lender_bank_id) !== lenderBankId
  ) {
    return failure("pick_persistence_unproven", 503);
  }

  if (listing.status !== "picked") {
    const { data: pickedListing, error: listingUpdateError } = await sb
      .from("marketplace_listings")
      .update({ status: "picked", picked_at: nowIso, updated_at: nowIso })
      .eq("id", listingId)
      .in("status", ["awaiting_borrower_pick", "claiming"])
      .select("id, status")
      .maybeSingle();
    if (listingUpdateError || pickedListing?.status !== "picked") {
      return failure("listing_pick_failed", 503, listingUpdateError);
    }
  }

  const { data: withdrawnClaims, error: withdrawError } = await sb
    .from("marketplace_claims")
    .update({ status: "withdrawn" })
    .eq("listing_id", listingId)
    .eq("status", "active")
    .neq("id", claimId)
    .select("id, status");
  if (withdrawError) return failure("losing_claims_withdrawal_failed", 503, withdrawError);
  if ((withdrawnClaims ?? []).some((row) => row.status !== "withdrawn")) {
    return failure("losing_claims_withdrawal_unproven", 503);
  }

  const { data: existingAccess, error: existingAccessError } = await sb
    .from("marketplace_package_access")
    .select(
      "id, listing_id, claim_id, deal_id, lender_bank_id, sealed_package_id, access_level, revoked_at",
    )
    .eq("claim_id", claimId)
    .eq("deal_id", dealId)
    .is("revoked_at", null)
    .maybeSingle();
  if (existingAccessError) {
    return failure("package_access_read_failed", 503, existingAccessError);
  }

  let access = existingAccess;
  if (!access) {
    const { data: insertedAccess, error: accessError } = await sb
      .from("marketplace_package_access")
      .insert({
        listing_id: listingId,
        claim_id: claimId,
        deal_id: dealId,
        lender_bank_id: lenderBankId,
        sealed_package_id: sealedPackageId,
        access_level: "full",
        granted_at: nowIso,
      })
      .select(
        "id, listing_id, claim_id, deal_id, lender_bank_id, sealed_package_id, access_level, revoked_at",
      )
      .single();
    if (accessError || !insertedAccess) {
      return failure("package_access_grant_failed", 503, accessError);
    }
    access = insertedAccess;
  }
  if (
    String(access.listing_id) !== listingId ||
    String(access.claim_id) !== claimId ||
    String(access.lender_bank_id) !== lenderBankId ||
    String(access.sealed_package_id) !== sealedPackageId ||
    access.access_level !== "full" ||
    access.revoked_at
  ) {
    return failure("package_access_grant_unproven", 503);
  }

  const { data: existingAudit, error: auditReadError } = await sb
    .from("marketplace_audit_log")
    .select("id")
    .eq("listing_id", listingId)
    .eq("deal_id", dealId)
    .eq("action", "borrower_pick")
    .limit(1)
    .maybeSingle();
  if (auditReadError) return failure("pick_audit_read_failed", 503, auditReadError);
  if (!existingAudit) {
    const { data: audit, error: auditError } = await sb
      .from("marketplace_audit_log")
      .insert({
        listing_id: listingId,
        deal_id: dealId,
        actor_bank_id: null,
        actor_scope: "borrower",
        action: "borrower_pick",
        metadata: {
          claim_id: claimId,
          pick_id: String(pick.id),
          access_id: String(access.id),
          sealed_package_id: sealedPackageId,
        },
        created_at: nowIso,
      })
      .select("id")
      .single();
    if (auditError || !audit) {
      return failure("pick_audit_persistence_failed", 503, auditError);
    }
  }

  const { queueLenderMessage } = await import("@/lib/brokerage/lenderComms");
  const selectedMessage = await queueLenderMessage(
    "borrower_selected_lender",
    { dealId, listingId, claimId, lenderBankId, stage: "picked" },
    "email",
    sb,
  );
  if (!selectedMessage.ok) {
    return failure("lender_selection_notification_failed", 503, selectedMessage.error);
  }
  const accessMessage = await queueLenderMessage(
    "package_access_granted",
    {
      dealId,
      listingId,
      claimId,
      lenderBankId,
      accessId: String(access.id),
      stage: "picked",
    },
    "email",
    sb,
  );
  if (!accessMessage.ok) {
    return failure("package_access_notification_failed", 503, accessMessage.error);
  }

  // Form preparation is independent of the already-sealed Trident release.
  // Keep it retriable without misrepresenting the proven lender access above.
  try {
    const { prepareBrokerageSbaForms } = await import(
      "@/lib/brokerage/borrowerFormsOrchestration"
    );
    await prepareBrokerageSbaForms(dealId, sb);
  } catch (err) {
    console.warn("[marketplace/pick] sba form-package prepare failed", {
      dealId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return NextResponse.json({
    ok: true,
    pickId: String(pick.id),
    accessId: String(access.id),
    pickedLenderBankId: lenderBankId,
  });
}
