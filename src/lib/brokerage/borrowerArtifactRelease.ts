import "server-only";

/** Release is separate from preparation: never call this from generation admission. */
export type BorrowerArtifactRelease = {
  released: boolean;
  reason: "bank_selection_required" | "released" | "state_unavailable";
};
type DB = { from: (table: string) => any };

/** A borrower selection alone is not proof of a bank claim or successful handoff. */
export async function getBorrowerArtifactRelease(dealId: string, sb: DB): Promise<BorrowerArtifactRelease> {
  const locked: BorrowerArtifactRelease = { released: false, reason: "bank_selection_required" };
  try {
    const { data: pick, error } = await sb.from("marketplace_picks")
      .select("listing_id,claim_id,picked_lender_bank_id,borrower_selected_at")
      .eq("deal_id", dealId).eq("status", "picked").maybeSingle();
    if (error) throw error;
    if (!pick?.listing_id || !pick.claim_id || !pick.picked_lender_bank_id || !pick.borrower_selected_at) return locked;
    const [claim, listing, grant] = await Promise.all([
      sb.from("marketplace_claims").select("id").eq("id", pick.claim_id)
        .eq("listing_id", pick.listing_id).eq("lender_bank_id", pick.picked_lender_bank_id)
        .eq("status", "active").maybeSingle(),
      sb.from("marketplace_listings").select("sealed_package_id")
        .eq("id", pick.listing_id).eq("deal_id", dealId).eq("status", "picked").maybeSingle(),
      sb.from("marketplace_package_access").select("sealed_package_id")
        .eq("deal_id", dealId).eq("listing_id", pick.listing_id).eq("claim_id", pick.claim_id)
        .eq("lender_bank_id", pick.picked_lender_bank_id).eq("access_level", "full")
        .is("revoked_at", null).maybeSingle(),
    ]);
    if (claim.error || listing.error || grant.error) throw new Error("release_read_failed");
    if (!claim.data || !listing.data?.sealed_package_id ||
        grant.data?.sealed_package_id !== listing.data.sealed_package_id) return locked;
    const sealed = await sb.from("buddy_sealed_packages").select("id")
      .eq("id", listing.data.sealed_package_id).eq("deal_id", dealId).is("unsealed_at", null).maybeSingle();
    if (sealed.error) throw sealed.error;
    return sealed.data ? { released: true, reason: "released" } : locked;
  } catch {
    // Uncertain authorization never releases content, but preparation/status still work.
    return { released: false, reason: "state_unavailable" };
  }
}
