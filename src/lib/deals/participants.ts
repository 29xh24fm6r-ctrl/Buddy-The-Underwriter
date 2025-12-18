import "server-only";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Internal audit logger for participant events
 * Records all assignments, removals, and changes
 */
async function logParticipantEvent({
  dealId,
  actorClerkUserId,
  targetClerkUserId,
  action,
  role,
  reason,
  metadata,
}: {
  dealId: string;
  actorClerkUserId?: string | null;
  targetClerkUserId?: string | null;
  action:
    | "ASSIGN_UNDERWRITER"
    | "UNASSIGN_UNDERWRITER"
    | "ASSIGN_BORROWER"
    | "UNASSIGN_BORROWER"
    | "DEACTIVATE_PARTICIPANT"
    | "REACTIVATE_PARTICIPANT"
    | "BULK_REASSIGN";
  role?: "borrower" | "underwriter" | "bank_admin" | "observer" | null;
  reason?: string | null;
  metadata?: any;
}) {
  const supabase = supabaseAdmin();
  await (supabase as any).from("deal_participant_events").insert({
    deal_id: dealId,
    actor_clerk_user_id: actorClerkUserId ?? null,
    target_clerk_user_id: targetClerkUserId ?? null,
    action,
    role: role ?? null,
    reason: reason ?? null,
    metadata: metadata ?? {},
  });
}

/**
 * Register borrower as participant on deal
 * Call after successful borrower upload/submission
 * Safe to call multiple times (upsert)
 * 
 * @throws Error if database operation fails
 */
export async function registerBorrowerParticipant(dealId: string, clerkUserId: string) {
  const supabase = supabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await (supabase as any)
    .from("deal_participants")
    .upsert(
      {
        deal_id: dealId,
        clerk_user_id: clerkUserId,
        role: "borrower",
        is_active: true,
        updated_at: now,
      },
      { onConflict: "deal_id,clerk_user_id,role" }
    );

  if (error) throw error;

  // Audit log
  await logParticipantEvent({
    dealId,
    actorClerkUserId: clerkUserId,
    targetClerkUserId: clerkUserId,
    action: "ASSIGN_BORROWER",
    role: "borrower",
    reason: "auto_registration",
  });
}

/**
 * Register underwriter as participant on deal
 * Admin-only operation (caller must verify permissions)
 * 
 * @throws Error if database operation fails
 */
export async function registerUnderwriterParticipant(
  dealId: string,
  clerkUserId: string,
  actorUserId?: string
) {
  const supabase = supabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await (supabase as any)
    .from("deal_participants")
    .upsert(
      {
        deal_id: dealId,
        clerk_user_id: clerkUserId,
        role: "underwriter",
        is_active: true,
        updated_at: now,
      },
      { onConflict: "deal_id,clerk_user_id,role" }
    );

  if (error) throw error;

  // Audit log
  await logParticipantEvent({
    dealId,
    actorClerkUserId: actorUserId ?? null,
    targetClerkUserId: clerkUserId,
    action: "ASSIGN_UNDERWRITER",
    role: "underwriter",
    reason: "manual_assignment",
  });
}

/**
 * Enforce borrower access to deal
 * Call at top of any borrower-scoped route
 * 
 * @throws Error with "unauthorized" if not signed in
 * @throws Error with "forbidden" if borrower not participant on deal
 */
export async function requireBorrowerOnDeal(dealId: string): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const supabase = supabaseAdmin();
  const { data, error } = await (supabase as any)
    .from("deal_participants")
    .select("id")
    .eq("deal_id", dealId)
    .eq("clerk_user_id", userId)
    .eq("role", "borrower")
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("forbidden");

  return userId;
}

/**
 * Enforce underwriter access to deal
 * Call at top of underwriter-scoped routes
 * 
 * @throws Error with "unauthorized" if not signed in
 * @throws Error with "forbidden" if underwriter not assigned to deal
 */
export async function requireUnderwriterOnDeal(dealId: string): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const supabase = supabaseAdmin();
  const { data, error } = await (supabase as any)
    .from("deal_participants")
    .select("id")
    .eq("deal_id", dealId)
    .eq("clerk_user_id", userId)
    .eq("role", "underwriter")
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("forbidden");

  return userId;
}

/**
 * Check if user has any role on deal
 * Returns role if participant, null if not
 */
export async function getUserRoleOnDeal(
  dealId: string,
  clerkUserId: string
): Promise<"borrower" | "underwriter" | "bank_admin" | null> {
  const supabase = supabaseAdmin();
  
  const { data, error } = await (supabase as any)
    .from("deal_participants")
    .select("role")
    .eq("deal_id", dealId)
    .eq("clerk_user_id", clerkUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  return (data as any).role;
}

/**
 * Deactivate participant (soft delete)
 * Use for reassignment, team changes, etc.
 */
export async function deactivateParticipant(
  dealId: string,
  clerkUserId: string,
  role: string,
  actorUserId?: string,
  reason?: string
) {
  const supabase = supabaseAdmin();
  
  const { error } = await (supabase as any)
    .from("deal_participants")
    .update({
      is_active: false,
      metadata: (supabase as any).raw(
        `metadata || '{"deactivated_at": "${new Date().toISOString()}"}'::jsonb`
      ),
    })
    .eq("deal_id", dealId)
    .eq("clerk_user_id", clerkUserId)
    .eq("role", role);

  if (error) throw error;

  // Audit log
  const action =
    role === "underwriter"
      ? "UNASSIGN_UNDERWRITER"
      : role === "borrower"
      ? "UNASSIGN_BORROWER"
      : "DEACTIVATE_PARTICIPANT";

  await logParticipantEvent({
    dealId,
    actorClerkUserId: actorUserId ?? null,
    targetClerkUserId: clerkUserId,
    action,
    role: role as any,
    reason: reason ?? "deactivation",
  });
}

/**
 * Get all active participants for a deal
 * Returns array of { clerk_user_id, role, updated_at }
 */
export async function getDealParticipants(dealId: string) {
  const supabase = supabaseAdmin();
  
  const { data, error } = await (supabase as any)
    .from("deal_participants")
    .select("clerk_user_id, role, updated_at, metadata")
    .eq("deal_id", dealId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Update participant activity timestamp
 * Call when borrower/underwriter performs action on deal
 */
export async function touchParticipant(dealId: string, clerkUserId: string, role: string) {
  const supabase = supabaseAdmin();
  
  const { error } = await (supabase as any)
    .from("deal_participants")
    .update({ updated_at: new Date().toISOString() })
    .eq("deal_id", dealId)
    .eq("clerk_user_id", clerkUserId)
    .eq("role", role);

  if (error) {
    console.warn("[touchParticipant] Failed to update activity:", error);
  }
}
