/**
 * Credit Committee Voting Logic
 * 
 * Deterministic quorum + outcome calculation for committee votes.
 * 
 * VOTING OUTCOMES:
 * - "approve" → All votes are approve (quorum met)
 * - "approve_with_conditions" → At least one conditional approval
 * - "decline" → At least one decline vote (veto power)
 * - "pending" → Quorum not yet met
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface CommitteeStatus {
  quorum: number;
  voteCount: number;
  tally: {
    approve: number;
    approve_with_conditions: number;
    decline: number;
  };
  outcome: "approve" | "approve_with_conditions" | "decline" | "pending";
  complete: boolean;
  votes: Array<{
    voter_user_id: string;
    voter_name: string | null;
    vote: string;
    comment: string | null;
    created_at: string;
  }>;
}

export async function getCommitteeStatus(args: {
  bankId: string;
  snapshotId: string;
}): Promise<CommitteeStatus> {
  const sb = supabaseAdmin();

  // Fetch committee members
  const { data: members } = await sb
    .from("bank_credit_committee_members")
    .select("user_id, role")
    .eq("bank_id", args.bankId);

  // Fetch votes for this snapshot
  const { data: votes } = await sb
    .from("credit_committee_votes")
    .select("voter_user_id, voter_name, vote, comment, created_at")
    .eq("decision_snapshot_id", args.snapshotId);

  // Calculate quorum (majority of committee members)
  const totalMembers = members?.length ?? 0;
  const quorum = Math.ceil(totalMembers / 2);
  const voteCount = votes?.length ?? 0;

  // Tally votes
  const tally = { approve: 0, approve_with_conditions: 0, decline: 0 };
  for (const v of votes ?? []) {
    if (v.vote === "approve") tally.approve++;
    else if (v.vote === "approve_with_conditions") tally.approve_with_conditions++;
    else if (v.vote === "decline") tally.decline++;
  }

  // Determine outcome
  let outcome: "approve" | "approve_with_conditions" | "decline" | "pending";
  
  if (tally.decline > 0) {
    // Any decline vote vetoes the decision
    outcome = "decline";
  } else if (tally.approve_with_conditions > 0) {
    // At least one conditional approval
    outcome = "approve_with_conditions";
  } else if (voteCount >= quorum && tally.approve > 0) {
    // Quorum met, all approvals
    outcome = "approve";
  } else {
    // Quorum not yet met
    outcome = "pending";
  }

  return {
    quorum,
    voteCount,
    tally,
    outcome,
    complete: voteCount >= quorum,
    votes: votes ?? []
  };
}

/**
 * Check if a user is eligible to vote (is a committee member)
 */
export async function isCommitteeMember(args: {
  bankId: string;
  userId: string;
}): Promise<boolean> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("bank_credit_committee_members")
    .select("id")
    .eq("bank_id", args.bankId)
    .eq("user_id", args.userId)
    .maybeSingle();

  return !!data;
}
