/**
 * Override Capture — Phase 66C, System 5
 *
 * Captures and persists override/feedback events from bankers,
 * normalizing free-text into structured form before storage.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedbackType } from "./feedbackTaxonomy";
import type { NormalizedFeedback } from "./feedbackNormalizer";
import { normalizeFeedback } from "./feedbackNormalizer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FeedbackEvent {
  id: string;
  bankId: string;
  dealId: string;
  actorType: string;
  feedbackType: FeedbackType;
  sourceSurface: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  feedbackText: string | null;
  normalized: NormalizedFeedback | null;
  createdAt: string;
}

export interface CaptureOverrideInput {
  bankId: string;
  dealId: string;
  actorType: string;
  feedbackType: FeedbackType;
  sourceSurface: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  feedbackText?: string;
}

/* ------------------------------------------------------------------ */
/*  captureOverride                                                    */
/* ------------------------------------------------------------------ */

export async function captureOverride(
  sb: SupabaseClient,
  input: CaptureOverrideInput,
): Promise<string> {
  const normalized: NormalizedFeedback | null = input.feedbackText
    ? normalizeFeedback(input.feedbackText, input.feedbackType)
    : null;

  const { data, error } = await sb
    .from("buddy_feedback_events")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      actor_type: input.actorType,
      feedback_type: input.feedbackType,
      source_surface: input.sourceSurface,
      linked_entity_type: input.linkedEntityType ?? null,
      linked_entity_id: input.linkedEntityId ?? null,
      feedback_text: input.feedbackText ?? null,
      normalized,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[overrideCapture] captureOverride failed:", error?.message);
    throw new Error(`Failed to capture feedback: ${error?.message ?? "unknown error"}`);
  }

  return data.id as string;
}

/* ------------------------------------------------------------------ */
/*  getRecentFeedback                                                  */
/* ------------------------------------------------------------------ */

export async function getRecentFeedback(
  sb: SupabaseClient,
  dealId: string,
  limit = 20,
): Promise<FeedbackEvent[]> {
  const { data, error } = await sb
    .from("buddy_feedback_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    console.error("[overrideCapture] getRecentFeedback failed:", error?.message);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    bankId: row.bank_id,
    dealId: row.deal_id,
    actorType: row.actor_type,
    feedbackType: row.feedback_type as FeedbackType,
    sourceSurface: row.source_surface,
    linkedEntityType: row.linked_entity_type,
    linkedEntityId: row.linked_entity_id,
    feedbackText: row.feedback_text,
    normalized: row.normalized as NormalizedFeedback | null,
    createdAt: row.created_at,
  }));
}
