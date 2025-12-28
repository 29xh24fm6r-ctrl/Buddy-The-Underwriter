import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * External Verification Endpoint
 * 
 * Allows regulators/auditors to verify decision integrity without authentication.
 * Returns attestation chain for a given snapshot hash.
 * 
 * Usage: GET /api/verify/{hash}
 * Example: GET /api/verify/a1b2c3d4e5f6...
 * 
 * Response:
 * {
 *   "valid": true,
 *   "snapshot": {
 *     "id": "...",
 *     "decision": "approve_with_conditions",
 *     "status": "final",
 *     "created_at": "2025-12-28T12:00:00Z"
 *   },
 *   "attestations": [
 *     {
 *       "role": "underwriter",
 *       "created_at": "2025-12-28T12:05:00Z",
 *       "statement": "I have reviewed and approve this decision."
 *     },
 *     {
 *       "role": "credit_chair",
 *       "created_at": "2025-12-28T12:10:00Z",
 *       "statement": "Credit committee approves."
 *     }
 *   ],
 *   "chain_of_custody": {
 *     "attestation_count": 2,
 *     "required_count": 2,
 *     "satisfied": true
 *   }
 * }
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ hash: string }> }
) {
  const { hash } = await ctx.params;
  const sb = supabaseAdmin();

  // Find attestations with this hash
  const { data: attestations, error: attestError } = await sb
    .from("decision_attestations")
    .select("decision_snapshot_id, created_at, attested_role, statement")
    .eq("snapshot_hash", hash)
    .order("created_at", { ascending: true });

  if (attestError || !attestations || attestations.length === 0) {
    return NextResponse.json({
      valid: false,
      error: "No attestations found for this hash. The hash may be invalid or the decision has not been attested.",
    });
  }

  // Get snapshot details (public-safe fields only)
  const snapshotId = attestations[0].decision_snapshot_id;
  const { data: snapshot } = await sb
    .from("decision_snapshots")
    .select("id, decision, status, created_at, confidence, decision_summary")
    .eq("id", snapshotId)
    .single();

  if (!snapshot) {
    return NextResponse.json({
      valid: false,
      error: "Snapshot not found",
    });
  }

  // Get bank attestation policy (for context)
  const { data: deal } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", attestations[0].decision_snapshot_id)
    .single();

  let policyInfo = null;
  if (deal?.bank_id) {
    const { data: policy } = await sb
      .from("bank_attestation_policies")
      .select("required_count, required_roles")
      .eq("bank_id", deal.bank_id)
      .single();

    policyInfo = policy
      ? {
          required_count: policy.required_count,
          required_roles: policy.required_roles,
        }
      : null;
  }

  // Return verification result
  return NextResponse.json({
    valid: true,
    verified_at: new Date().toISOString(),
    snapshot: {
      id: snapshot.id,
      decision: snapshot.decision,
      status: snapshot.status,
      confidence: snapshot.confidence ? Math.round(snapshot.confidence * 100) + "%" : null,
      summary: snapshot.decision_summary,
      created_at: snapshot.created_at,
    },
    attestations: attestations.map((att) => ({
      role: att.attested_role,
      statement: att.statement,
      created_at: att.created_at,
    })),
    chain_of_custody: {
      attestation_count: attestations.length,
      required_count: policyInfo?.required_count ?? 1,
      satisfied: policyInfo
        ? attestations.length >= policyInfo.required_count
        : true,
      hash: hash,
    },
    _note: "This endpoint allows public verification of decision integrity without authentication. Share this link with regulators/auditors.",
  });
}
