import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBuddySBAScore } from "@/lib/score/buddySbaScore";

/** Deterministic scoring follows artifact validation, before atomic publication.
 * A low score remains a low score: locking is not approval or borrower release. */
export async function finalizePackageScore(sb: SupabaseClient, evidence: {
  dealId: string; bankId: string; bundleId: string; inputHash: string;
  packageId: string | null; feasibilityId: string | null;
}) {
  if (!evidence.packageId || !evidence.feasibilityId) throw new Error("Package score evidence is incomplete");
  const score = await computeBuddySBAScore({ dealId: evidence.dealId, sb, context: "package_seal",
    packageEvidence: { ...evidence, packageId: evidence.packageId, feasibilityId: evidence.feasibilityId },
  });
  if (!score.id || score.bankId !== evidence.bankId) throw new Error("Package score identity mismatch");
  // Compare-and-set the exact computed row. Never lock a concurrent replacement.
  const { data, error } = await sb.from("buddy_sba_scores")
    .update({ score_status: "locked", locked_at: new Date().toISOString() })
    .eq("id", score.id).eq("deal_id", evidence.dealId).eq("bank_id", evidence.bankId)
    .is("superseded_at", null).in("score_status", ["draft", "locked"])
    .select("id").maybeSingle();
  if (error || !data) throw new Error("Package score could not be finalized; retry package preparation");
  return data.id as string;
}
