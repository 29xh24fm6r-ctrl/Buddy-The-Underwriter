/**
 * Failure Library — Phase 66A
 *
 * Institutional memory of research failures.
 * Learns from past errors to avoid repeating them:
 * - Recognizes known failure patterns
 * - Suggests resolution strategies
 * - Tracks cooldowns for rate-limited sources
 */

import "server-only";

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export type FailureCategory =
  | "source_unavailable"
  | "rate_limited"
  | "extraction_failed"
  | "inference_failed"
  | "timeout"
  | "schema_mismatch"
  | "auth_expired"
  | "data_quality"
  | "model_error"
  | "unknown";

export type FailureEntry = {
  id: string;
  failure_code: string;
  failure_category: FailureCategory;
  source_domain: string | null;
  mission_type: string | null;
  error_signature: string;
  resolution_strategy: string | null;
  auto_retryable: boolean;
  cooldown_seconds: number | null;
  example_mission_id: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
};

// ============================================================================
// Error Signature
// ============================================================================

/**
 * Generate a normalized error signature for dedup.
 * Strips dynamic values (IDs, timestamps, URLs) to find the pattern.
 */
export function generateErrorSignature(error: Error | string): string {
  const msg = typeof error === "string" ? error : error.message;
  const normalized = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "<TIMESTAMP>")
    .replace(/https?:\/\/[^\s]+/g, "<URL>")
    .replace(/\d+/g, "<N>")
    .trim()
    .slice(0, 500);

  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Classify a failure category from an error.
 */
export function classifyFailure(error: Error | string): FailureCategory {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("timeout") || msg.includes("etimedout")) return "timeout";
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) return "rate_limited";
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("503") || msg.includes("502")) return "source_unavailable";
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return "auth_expired";
  if (msg.includes("schema") || msg.includes("validation") || msg.includes("unexpected type")) return "schema_mismatch";
  if (msg.includes("extraction") || msg.includes("parse")) return "extraction_failed";
  if (msg.includes("inference") || msg.includes("derive")) return "inference_failed";
  if (msg.includes("model") || msg.includes("gemini") || msg.includes("claude")) return "model_error";
  if (msg.includes("empty") || msg.includes("no data") || msg.includes("missing")) return "data_quality";

  return "unknown";
}

/**
 * Extract domain from a URL.
 */
function extractDomain(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ============================================================================
// Record Failure
// ============================================================================

/**
 * Record a failure in the library. If a matching pattern exists, increment count.
 */
export async function recordFailure(
  sb: SupabaseClient,
  input: {
    error: Error | string;
    mission_id?: string;
    mission_type?: string;
    source_url?: string;
    resolution_strategy?: string;
    auto_retryable?: boolean;
    cooldown_seconds?: number;
  },
): Promise<void> {
  const category = classifyFailure(input.error);
  const signature = generateErrorSignature(input.error);
  const domain = extractDomain(input.source_url);
  const failureCode = `${category}:${signature}`;

  const { data: existing } = await sb
    .from("buddy_research_failure_library")
    .select("id, occurrence_count")
    .eq("failure_code", failureCode)
    .eq("error_signature", signature)
    .maybeSingle();

  if (existing) {
    // Increment existing entry
    await sb
      .from("buddy_research_failure_library")
      .update({
        occurrence_count: existing.occurrence_count + 1,
        last_seen_at: new Date().toISOString(),
        example_mission_id: input.mission_id ?? undefined,
      })
      .eq("id", existing.id);
  } else {
    // Create new entry
    await sb.from("buddy_research_failure_library").insert({
      failure_code: failureCode,
      failure_category: category,
      source_domain: domain,
      mission_type: input.mission_type ?? null,
      error_signature: signature,
      resolution_strategy: input.resolution_strategy ?? null,
      auto_retryable: input.auto_retryable ?? false,
      cooldown_seconds: input.cooldown_seconds ?? null,
      example_mission_id: input.mission_id ?? null,
    });
  }
}

// ============================================================================
// Lookup Failure
// ============================================================================

/**
 * Check if a source domain is in cooldown (recently rate-limited or unavailable).
 */
export async function isSourceInCooldown(
  sb: SupabaseClient,
  domain: string,
): Promise<{ inCooldown: boolean; resumeAfter?: string }> {
  const { data } = await sb
    .from("buddy_research_failure_library")
    .select("cooldown_seconds, last_seen_at")
    .eq("source_domain", domain)
    .in("failure_category", ["rate_limited", "source_unavailable"])
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data || !data.cooldown_seconds) {
    return { inCooldown: false };
  }

  const lastSeen = new Date(data.last_seen_at).getTime();
  const cooldownEnd = lastSeen + data.cooldown_seconds * 1000;

  if (Date.now() < cooldownEnd) {
    return {
      inCooldown: true,
      resumeAfter: new Date(cooldownEnd).toISOString(),
    };
  }

  return { inCooldown: false };
}

/**
 * Get known failure patterns for a mission type.
 */
export async function getKnownFailures(
  sb: SupabaseClient,
  missionType: string,
): Promise<FailureEntry[]> {
  const { data } = await sb
    .from("buddy_research_failure_library")
    .select("*")
    .eq("mission_type", missionType)
    .order("occurrence_count", { ascending: false })
    .limit(20);

  return (data ?? []) as FailureEntry[];
}
