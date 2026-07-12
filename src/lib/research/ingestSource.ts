/**
 * Source Ingestion Engine
 *
 * Fetches and stores raw source data.
 * raw_content is NEVER mutated after storage.
 * checksum proves data integrity.
 */

import type { DiscoveredSource, ResearchSource, SourceIngestionResult } from "./types";
import { fetchSource } from "./fetch/fetchSource";

/**
 * Fetch a source URL with timeout, retry-with-backoff, allowlist enforcement,
 * and response size limits.
 *
 * FIX (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1): this previously used a
 * bare inline fetch() — a single attempt, no retry, no allowlist check — even
 * though a fully-built, tested, retrying+allowlisted fetch layer already
 * existed at ./fetch/fetchSource.ts and was simply never called. Any
 * transient network blip (a single 503 from a government API) permanently
 * failed that source for the mission. Delegating to fetchSource() here closes
 * that gap with no behavior change to callers of ingestSource/ingestSources.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 30_000
): Promise<{ ok: boolean; data?: unknown; status?: number; error?: string; durationMs: number; checksum?: string }> {
  const result = await fetchSource(url, { timeout_ms: timeoutMs });

  if (!result.ok) {
    return {
      ok: false,
      status: result.http_status,
      error: result.error_message ?? result.error_code ?? "Unknown fetch error",
      durationMs: result.duration_ms ?? 0,
    };
  }

  const contentType = result.content_type ?? "";
  const data: unknown = contentType.includes("json")
    ? result.body
    : { _raw_text: result.raw_text ?? "", _content_type: contentType };

  return {
    ok: true,
    data,
    status: result.http_status,
    durationMs: result.duration_ms ?? 0,
    checksum: result.checksum,
  };
}

/**
 * Ingest a single source.
 * Fetches the URL, computes checksum, returns the source record (not yet persisted).
 */
export async function ingestSource(
  missionId: string,
  discovered: DiscoveredSource,
  opts?: { timeoutMs?: number }
): Promise<SourceIngestionResult> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  // Fetch the source
  const fetchResult = await fetchWithTimeout(discovered.url, timeoutMs);

  if (!fetchResult.ok || fetchResult.data === undefined) {
    // Return a source record with the error (still store for audit)
    const source: ResearchSource = {
      id: "", // Will be set by DB
      mission_id: missionId,
      source_class: discovered.source_class,
      source_name: discovered.source_name,
      source_url: discovered.url,
      raw_content: null as unknown,
      content_type: null,
      checksum: "",
      retrieved_at: new Date().toISOString(),
      http_status: fetchResult.status ?? null,
      fetch_duration_ms: fetchResult.durationMs,
      fetch_error: fetchResult.error ?? "Unknown error",
    };

    return { ok: false, source, error: fetchResult.error };
  }

  // Checksum of the raw response body, computed by fetchSource().
  const checksum = fetchResult.checksum ?? "";

  const source: ResearchSource = {
    id: "", // Will be set by DB
    mission_id: missionId,
    source_class: discovered.source_class,
    source_name: discovered.source_name,
    source_url: discovered.url,
    raw_content: fetchResult.data,
    content_type: "application/json",
    checksum,
    retrieved_at: new Date().toISOString(),
    http_status: fetchResult.status ?? 200,
    fetch_duration_ms: fetchResult.durationMs,
    fetch_error: null,
  };

  return { ok: true, source };
}

/**
 * Ingest multiple sources in parallel with concurrency limit.
 */
export async function ingestSources(
  missionId: string,
  discovered: DiscoveredSource[],
  opts?: { concurrency?: number; timeoutMs?: number }
): Promise<SourceIngestionResult[]> {
  const concurrency = opts?.concurrency ?? 3;
  const results: SourceIngestionResult[] = [];

  // Process in batches
  for (let i = 0; i < discovered.length; i += concurrency) {
    const batch = discovered.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((d) => ingestSource(missionId, d, { timeoutMs: opts?.timeoutMs }))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Check if a source has valid content (not an error response).
 */
export function hasValidContent(source: ResearchSource): boolean {
  const httpStatus = source.http_status;
  return (
    source.fetch_error === null &&
    source.raw_content !== null &&
    httpStatus != null &&
    httpStatus >= 200 &&
    httpStatus < 300
  );
}
