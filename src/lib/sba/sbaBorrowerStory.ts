import "server-only";

// src/lib/sba/sbaBorrowerStory.ts
// God Tier Business Plan — Step 2
// Loader/saver for the borrower's discovery interview answers. This story data
// is OPTIONAL: the SBA package pipeline degrades gracefully when no story has
// been captured. When present, it is threaded through every narrative prompt
// and becomes the raw material for a plan written in the borrower's voice.

import { supabaseAdmin } from "@/lib/supabase/admin";

export type VoiceFormality = "casual" | "professional" | "technical";
export type CapturedVia = "voice" | "chat" | "form";

export interface BorrowerStory {
  dealId: string;
  originStory: string | null;
  competitiveInsight: string | null;
  idealCustomer: string | null;
  growthStrategy: string | null;
  biggestRisk: string | null;
  personalVision: string | null;
  voiceFormality: VoiceFormality | null;
  voiceMetaphors: string[];
  voiceValues: string[];
  capturedVia: CapturedVia;
  capturedAt: string;
}

type StoryRow = {
  deal_id: string;
  origin_story: string | null;
  competitive_insight: string | null;
  ideal_customer: string | null;
  growth_strategy: string | null;
  biggest_risk: string | null;
  personal_vision: string | null;
  voice_formality: VoiceFormality | null;
  voice_metaphors: unknown;
  voice_values: unknown;
  captured_via: CapturedVia | null;
  captured_at: string | null;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function rowToStory(row: StoryRow): BorrowerStory {
  return {
    dealId: row.deal_id,
    originStory: row.origin_story,
    competitiveInsight: row.competitive_insight,
    idealCustomer: row.ideal_customer,
    growthStrategy: row.growth_strategy,
    biggestRisk: row.biggest_risk,
    personalVision: row.personal_vision,
    voiceFormality: row.voice_formality,
    voiceMetaphors: asStringArray(row.voice_metaphors),
    voiceValues: asStringArray(row.voice_values),
    capturedVia: row.captured_via ?? "chat",
    capturedAt: row.captured_at ?? new Date().toISOString(),
  };
}

export async function loadBorrowerStory(
  dealId: string,
): Promise<BorrowerStory | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_borrower_stories")
    .select(
      "deal_id, origin_story, competitive_insight, ideal_customer, growth_strategy, biggest_risk, personal_vision, voice_formality, voice_metaphors, voice_values, captured_via, captured_at",
    )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    console.error("[sbaBorrowerStory] loadBorrowerStory error:", error);
    return null;
  }
  if (!data) return null;
  return rowToStory(data as StoryRow);
}

export async function saveBorrowerStory(
  dealId: string,
  story: Partial<Omit<BorrowerStory, "dealId" | "capturedAt">>,
): Promise<void> {
  const sb = supabaseAdmin();

  const payload: Record<string, unknown> = {
    deal_id: dealId,
    updated_at: new Date().toISOString(),
  };

  if (story.originStory !== undefined) payload.origin_story = story.originStory;
  if (story.competitiveInsight !== undefined)
    payload.competitive_insight = story.competitiveInsight;
  if (story.idealCustomer !== undefined)
    payload.ideal_customer = story.idealCustomer;
  if (story.growthStrategy !== undefined)
    payload.growth_strategy = story.growthStrategy;
  if (story.biggestRisk !== undefined) payload.biggest_risk = story.biggestRisk;
  if (story.personalVision !== undefined)
    payload.personal_vision = story.personalVision;
  if (story.voiceFormality !== undefined)
    payload.voice_formality = story.voiceFormality;
  if (story.voiceMetaphors !== undefined)
    payload.voice_metaphors = story.voiceMetaphors;
  if (story.voiceValues !== undefined) payload.voice_values = story.voiceValues;
  if (story.capturedVia !== undefined) payload.captured_via = story.capturedVia;

  const { error } = await sb
    .from("buddy_borrower_stories")
    .upsert(payload, { onConflict: "deal_id" });

  if (error) {
    console.error("[sbaBorrowerStory] saveBorrowerStory error:", error);
    throw new Error(`saveBorrowerStory_failed: ${error.message}`);
  }
}

/**
 * Returns true if the story has enough substance to drive god-tier narrative
 * generation. Origin story, competitive insight, and growth strategy are the
 * three that carry the most weight in the downstream prompts — without them,
 * the narrative falls back to template tone.
 */
export function hasCompleteBorrowerStory(
  story: BorrowerStory | null,
): boolean {
  if (!story) return false;
  const nonEmpty = (s: string | null) => typeof s === "string" && s.trim().length > 0;
  return (
    nonEmpty(story.originStory) &&
    nonEmpty(story.competitiveInsight) &&
    nonEmpty(story.growthStrategy)
  );
}
