import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface AttestationStatus {
  requiredCount: number;
  completedCount: number;
  satisfied: boolean;
  requiredRoles: string[] | null;
  missingRoles: string[];
  attestations: any[];
}

/**
 * Checks if a decision snapshot has met the bank's attestation policy
 * Returns status including progress and missing requirements
 */
export async function getAttestationStatus(
  dealId: string,
  snapshotId: string,
  bankId: string
): Promise<AttestationStatus> {
  const sb = supabaseAdmin();

  // Fetch bank's attestation policy
  const { data: policy } = await sb
    .from("bank_attestation_policies")
    .select("*")
    .eq("bank_id", bankId)
    .maybeSingle();

  const requiredCount = policy?.required_count ?? 1;
  const requiredRoles = policy?.required_roles ?? null;

  // Fetch all attestations for this snapshot
  const { data: attestations } = await sb
    .from("decision_attestations")
    .select("*")
    .eq("decision_snapshot_id", snapshotId)
    .order("created_at", { ascending: false });

  const allAttestations = attestations ?? [];

  // Filter valid attestations based on role requirements
  const validAttestations = requiredRoles
    ? allAttestations.filter((a) => requiredRoles.includes(a.attested_role))
    : allAttestations;

  // Calculate missing roles (if role requirements exist)
  let missingRoles: string[] = [];
  if (requiredRoles) {
    const attestedRoles = new Set(validAttestations.map((a) => a.attested_role));
    missingRoles = requiredRoles.filter((role: string) => !attestedRoles.has(role));
  }

  return {
    requiredCount,
    completedCount: validAttestations.length,
    satisfied: validAttestations.length >= requiredCount && missingRoles.length === 0,
    requiredRoles,
    missingRoles,
    attestations: allAttestations,
  };
}

/**
 * Checks if a snapshot can be marked as "attestation complete"
 * Used in UI to show completion badges
 */
export async function isAttestationComplete(
  dealId: string,
  snapshotId: string,
  bankId: string
): Promise<boolean> {
  const status = await getAttestationStatus(dealId, snapshotId, bankId);
  return status.satisfied;
}
