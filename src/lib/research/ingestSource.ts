/**
 * Source Ingestion Engine
 *
 * Fetches and stores raw source data.
 * raw_content is NEVER mutated after storage.
 * checksum proves data integrity.
 */

import { createHash } from "crypto";
import type { DiscoveredSource, ResearchSource, SourceIngestionResult } from "./types";

/**
 * Compute SHA-256 checksum of content.
 * Uses canonical JSON stringification for consistency.
 */
function computeChecksum(content: unknown): string {
  const canonical = JSON.stringify(content, Object.keys(content as object).sort());
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Fetch a source URL with timeout and error handling.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 30_000
): Promise<{ ok: boolean; data?: unknown; status?: number; error?: string; durationMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "BuddyResearchEngine/1.0 (Commercial Lending Research)",
      },
    });

    clearTimeout(timeoutId);
    const durationMs = Date.now() - start;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
        durationMs,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";

    let data: unknown;
    if (contentType.includes("json")) {
      data = await response.json();
    } else {
      // Store as text for non-JSON responses
      data = { _raw_text: await response.text(), _content_type: contentType };
    }

    return {
      ok: true,
      data,
      status: response.status,
      durationMs,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - start;

    if ((error as Error).name === "AbortError") {
      return { ok: false, error: `Timeout after ${timeoutMs}ms`, durationMs };
    }

    return {
      ok: false,
      error: (error as Error).message ?? "Unknown fetch error",
      durationMs,
    };
  }
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

  // Compute checksum of the raw content
  const checksum = computeChecksum(fetchResult.data);

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
