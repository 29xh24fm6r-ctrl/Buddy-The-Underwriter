// Message Queue System

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MessageDraft } from "./aiDraft";

export type QueuedMessage = {
  id?: string;
  application_id: string;
  condition_id: string;
  channel: "EMAIL" | "PORTAL" | "SMS";
  direction: "OUTBOUND";
  status: "DRAFT" | "QUEUED" | "SENT" | "FAILED" | "SKIPPED";
  subject: string;
  body: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  trigger_type: string;
  ai_generated: boolean;
  requires_approval: boolean;
  metadata: Record<string, any>;
  created_at?: string;
  sent_at?: string;
};

export async function queueMessage(
  applicationId: string,
  conditionId: string,
  draft: MessageDraft,
  options: {
    requiresApproval?: boolean;
    status?: "DRAFT" | "QUEUED";
  } = {}
): Promise<string> {
  const sb = supabaseAdmin();

  const message: QueuedMessage = {
    application_id: applicationId,
    condition_id: conditionId,
    channel: draft.channel,
    direction: "OUTBOUND",
    status: options.status || (options.requiresApproval ? "DRAFT" : "QUEUED"),
    subject: draft.subject,
    body: draft.body,
    priority: draft.priority,
    trigger_type: draft.metadata.trigger_type,
    ai_generated: draft.ai_generated,
    requires_approval: options.requiresApproval ?? true,
    metadata: draft.metadata,
  };

  const { data, error } = await (sb as any)
    .from("condition_messages")
    .insert(message)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to queue message: ${error.message}`);
  }

  return data.id;
}

export async function approveMessage(messageId: string, approvedBy: string): Promise<void> {
  const sb = supabaseAdmin();

  await (sb as any)
    .from("condition_messages")
    .update({
      status: "QUEUED",
      requires_approval: false,
      metadata: (sb as any).raw(
        `metadata || '{"approved_by": "${approvedBy}", "approved_at": "${new Date().toISOString()}"}'::jsonb`
      ),
    })
    .eq("id", messageId)
    .eq("status", "DRAFT");
}

export async function skipMessage(
  messageId: string,
  reason: string,
  metadata?: Record<string, any>
): Promise<void> {
  const sb = supabaseAdmin();

  await (sb as any)
    .from("condition_messages")
    .update({
      status: "SKIPPED",
      metadata: {
        skip_reason: reason,
        skipped_at: new Date().toISOString(),
        ...metadata,
      },
    })
    .eq("id", messageId);
}

export async function getQueuedMessages(
  applicationId: string,
  options: {
    status?: string[];
    conditionId?: string;
    limit?: number;
  } = {}
): Promise<QueuedMessage[]> {
  const sb = supabaseAdmin();

  let query = (sb as any)
    .from("condition_messages")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });

  if (options.status && options.status.length > 0) {
    query = query.in("status", options.status);
  }

  if (options.conditionId) {
    query = query.eq("condition_id", options.conditionId);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data } = await query;
  return data || [];
}

export async function getMessageAuditLog(
  applicationId: string,
  conditionId?: string
): Promise<any[]> {
  const sb = supabaseAdmin();

  let query = (sb as any)
    .from("condition_messages")
    .select("*")
    .eq("application_id", applicationId)
    .in("status", ["SENT", "FAILED", "SKIPPED"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (conditionId) {
    query = query.eq("condition_id", conditionId);
  }

  const { data } = await query;
  return data || [];
}
