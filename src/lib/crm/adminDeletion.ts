import "server-only";

import type { Json } from "@/types/supabase";
import { supabaseAdmin } from "@/lib/supabase/admin";

type DeletionEntity = "organization" | "person" | "lead" | "activity" | "deal";
type AdminClient = ReturnType<typeof supabaseAdmin>;

export function confirmationMatches(received: unknown, expected: string): boolean {
  return typeof received === "string" && received.trim() === expected.trim();
}

export async function beginCrmDeletion(args: {
  sb: AdminClient;
  bankId: string;
  actorUserId: string;
  entityType: DeletionEntity;
  entityId: string;
  entityLabel: string;
  snapshot: unknown;
}): Promise<string> {
  const { data, error } = await args.sb
    .from("crm_admin_deletion_log")
    .insert({
      bank_id: args.bankId,
      actor_clerk_user_id: args.actorUserId,
      entity_type: args.entityType,
      entity_id: args.entityId,
      entity_label: args.entityLabel,
      snapshot: args.snapshot as Json,
      status: "requested",
    })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message ?? "deletion_audit_failed");
  return data.id;
}

export async function finishCrmDeletion(
  sb: AdminClient,
  auditId: string,
  result: { ok: true } | { ok: false; reason: string },
): Promise<void> {
  const { error } = await sb
    .from("crm_admin_deletion_log")
    .update({
      status: result.ok ? "completed" : "failed",
      failure_reason: result.ok ? null : result.reason.slice(0, 500),
    })
    .eq("id", auditId);
  if (error) console.error("[crm-admin-deletion] audit completion failed", { auditId, error: error.message });
}
