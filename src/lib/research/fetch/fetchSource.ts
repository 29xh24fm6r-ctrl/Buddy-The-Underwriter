/**
 * Fetch Layer - Reliable Source Fetching with Caching & Retries
 *
 * Features:
 * - Retries with exponential backoff
 * - Response size limits
 * - Timeout handling
 * - ETag/If-Modified-Since caching support
 * - Rate limit tracking
 * - Never throws past boundary (returns ok:false)
 */

import { createHash } from "crypto";
import {
  lookupSource,
  getSourceHeaders,
  logBlockedSource,
  type SourceRegistryEntry,
} from "../sources/registry";

// ============================================================================
// Types
// ============================================================================

export type FetchResult = {
  ok: boolean;
  /** Response body (parsed based on content type) */
  body?: unknown;
  /** Raw response text */
  raw_text?: string;
  /** Content type header */
  content_type?: string;
  /** SHA256 checksum of response body */
  checksum?: string;
  /** HTTP status code */
  http_status?: number;
  /** Fetch duration in milliseconds */
  duration_ms?: number;
  /** Whether response came from cache */
  from_cache?: boolean;
  /** ETag for caching */
  etag?: string;
  /** Last-Modified header for caching */
  last_modified?: string;
  /** Error code if failed */
  error_code?: FetchErrorCode;
  /** Error message if failed */
  error_message?: string;
};

export type FetchErrorCode =
  | "BLOCKED_SOURCE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "TOO_LARGE"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "PARSE_ERROR"
  | "INVALID_URL";

export type FetchOptions = {
  /** Request timeout in milliseconds (default: from registry or 30000) */
  timeout_ms?: number;
  /** Maximum response size in bytes (default: from registry or 5MB) */
  max_size_bytes?: number;
  /** Number of retries on failure (default: 3) */
  max_retries?: number;
  /** Mission ID for logging */
  mission_id?: string;
  /** ETag from previous fetch (for conditional requests) */
  if_none_match?: string;
  /** Last-Modified from previous fetch (for conditional requests) */
  if_modified_since?: string;
  /** Additional headers to include */
  headers?: Record<string, string>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10000;
const BACKOFF_MULTIPLIER = 2;

// ============================================================================
// Rate Limit Tracking
// ============================================================================

type RateLimitEntry = {
  requests: number;
  window_start: number;
};

const rateLimitTracker = new Map<string, RateLimitEntry>();

function checkRateLimit(domain: string, rpm: number): boolean {
  const now = Date.now();
  const entry = rateLimitTracker.get(domain);
  const windowMs = 60000; // 1 minute

  if (!entry || now - entry.window_start > windowMs) {
    // New window
    rateLimitTracker.set(domain, { requests: 1, window_start: now });
    return true;
  }

  if (entry.requests >= rpm) {
    return false; // Rate limited
  }

  entry.requests++;
  return true;
}

// ============================================================================
// Checksum Calculation
// ============================================================================

function calculateChecksum(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ============================================================================
// Main Fetch Function
// ============================================================================

/**
 * Fetch a source URL with retries, caching, and rate limiting.
 * Never throws - always returns a FetchResult.
 */
export async function fetchSource(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const startTime = Date.now();

  // 1. Validate URL against registry
  const lookup = lookupSource(url);
  if (!lookup.allowed) {
    logBlockedSource(url, lookup.reason ?? "Unknown", options.mission_id);
    return {
      ok: false,
      error_code: "BLOCKED_SOURCE",
      error_message: lookup.reason ?? `Source not in allowlist: ${url}`,
      duration_ms: Date.now() - startTime,
    };
  }

  const registryEntry = lookup.entry!;
  const timeout = options.timeout_ms ?? registryEntry.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const maxSize = options.max_size_bytes ?? registryEntry.max_response_bytes ?? DEFAULT_MAX_SIZE_BYTES;
  const maxRetries = options.max_retries ?? DEFAULT_MAX_RETRIES;

  // 2. Check rate limit
  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return {
      ok: false,
      error_code: "INVALID_URL",
      error_message: `Invalid URL: ${url}`,
      duration_ms: Date.now() - startTime,
    };
  }

  if (!checkRateLimit(domain, registryEntry.rate_limit_rpm)) {
    return {
      ok: false,
      error_code: "RATE_LIMITED",
      error_message: `Rate limit exceeded for ${domain}`,
      duration_ms: Date.now() - startTime,
    };
  }

  // 3. Build headers
  const headers: Record<string, string> = {
    "Accept": "application/json, text/html, application/xml, */*",
    "User-Agent": "BuddyTheUnderwriter/1.0 (institutional lending research)",
    ...getSourceHeaders(url),
    ...options.headers,
  };

  // Add conditional request headers if provided
  if (options.if_none_match) {
    headers["If-None-Match"] = options.if_none_match;
  }
  if (options.if_modified_since) {
    headers["If-Modified-Since"] = options.if_modified_since;
  }

  // 4. Fetch with retries
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const result = await fetchWithTimeout(url, headers, timeout, maxSize);

      // Check for 304 Not Modified
      if (result.http_status === 304) {
        return {
          ok: true,
          http_status: 304,
          from_cache: true,
          duration_ms: Date.now() - startTime,
        };
      }

      // Check for HTTP errors
      if (result.http_status && (result.http_status < 200 || result.http_status >= 300)) {
        // Some errors are retryable
        if (isRetryableStatus(result.http_status) && attempt < maxRetries) {
          await sleep(getBackoffMs(attempt));
          attempt++;
          continue;
        }

        return {
          ok: false,
          http_status: result.http_status,
          error_code: "HTTP_ERROR",
          error_message: `HTTP ${result.http_status}`,
          duration_ms: Date.now() - startTime,
        };
      }

      // Parse response based on content type
      const parsed = parseResponse(result.raw_text ?? "", result.content_type);

      return {
        ok: true,
        body: parsed.body,
        raw_text: result.raw_text,
        content_type: result.content_type,
        checksum: calculateChecksum(result.raw_text ?? ""),
        http_status: result.http_status,
        duration_ms: Date.now() - startTime,
        from_cache: false,
        etag: result.etag,
        last_modified: result.last_modified,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if retryable
      if (isRetryableError(lastError) && attempt < maxRetries) {
        await sleep(getBackoffMs(attempt));
        attempt++;
        continue;
      }

      break;
    }
  }

  // All retries exhausted
  const errorCode = getErrorCode(lastError);
  return {
    ok: false,
    error_code: errorCode,
    error_message: lastError?.message ?? "Unknown error",
    duration_ms: Date.now() - startTime,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

type RawFetchResult = {
  raw_text?: string;
  content_type?: string;
  http_status?: number;
  etag?: string;
  last_modified?: string;
};

async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  maxSizeBytes: number
): Promise<RawFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    // Check content length
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    // Read response with size limit
    const text = await readResponseWithLimit(response, maxSizeBytes);

    return {
      raw_text: text,
      content_type: response.headers.get("content-type") ?? undefined,
      http_status: response.status,
      etag: response.headers.get("etag") ?? undefined,
      last_modified: response.headers.get("last-modified") ?? undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseWithLimit(
  response: Response,
  maxSizeBytes: number
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    totalSize += value.length;
    if (totalSize > maxSizeBytes) {
      reader.cancel();
      throw new Error(`Response exceeded size limit: ${maxSizeBytes} bytes`);
    }

    chunks.push(value);
  }

  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}

function parseResponse(
  text: string,
  contentType?: string
): { body: unknown } {
  // Try to parse based on content type
  if (contentType?.includes("application/json")) {
    try {
      return { body: JSON.parse(text) };
    } catch {
      return { body: text };
    }
  }

  if (contentType?.includes("application/xml") || contentType?.includes("text/xml")) {
    // Return raw XML - parsing is done by extractors
    return { body: text };
  }

  // For HTML and other text, return as-is
  return { body: text };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up") ||
    message.includes("network") ||
    error.name === "AbortError"
  );
}

function getErrorCode(error?: Error): FetchErrorCode {
  if (!error) return "NETWORK_ERROR";

  const message = error.message.toLowerCase();
  if (error.name === "AbortError" || message.includes("timeout")) {
    return "TIMEOUT";
  }
  if (message.includes("size limit") || message.includes("too large")) {
    return "TOO_LARGE";
  }
  return "NETWORK_ERROR";
}

function getBackoffMs(attempt: number): number {
  const backoff = INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt);
  return Math.min(backoff, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Cache Management (in-memory for now)
// ============================================================================

export type CacheEntry = {
  url: string;
  checksum: string;
  body: unknown;
  etag?: string;
  last_modified?: string;
  cached_at: number;
  ttl_seconds: number;
};

const cache = new Map<string, CacheEntry>();

/**
 * Get cached response if available and not expired.
 */
export function getCachedResponse(url: string): CacheEntry | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;

  const now = Date.now();
  const expiresAt = entry.cached_at + entry.ttl_seconds * 1000;

  if (now > expiresAt) {
    cache.delete(url);
    return undefined;
  }

  return entry;
}

/**
 * Store response in cache.
 */
export function setCachedResponse(
  url: string,
  body: unknown,
  checksum: string,
  etag?: string,
  lastModified?: string,
  ttlSeconds = 900 // 15 minutes default
): void {
  cache.set(url, {
    url,
    checksum,
    body,
    etag,
    last_modified: lastModified,
    cached_at: Date.now(),
    ttl_seconds: ttlSeconds,
  });

  // Limit cache size
  if (cache.size > 1000) {
    // Remove oldest entries
    const entries = Array.from(cache.entries());
    entries.sort((a, b) => a[1].cached_at - b[1].cached_at);
    for (let i = 0; i < 100; i++) {
      cache.delete(entries[i][0]);
    }
  }
}

/**
 * Clear the cache (for testing).
 */
export function clearCache(): void {
  cache.clear();
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; entries: number } {
  return {
    size: cache.size,
    entries: cache.size,
  };
}

// ============================================================================
// Smart Fetch with Caching
// ============================================================================

/**
 * Fetch with automatic cache handling.
 * Uses ETag/If-Modified-Since when available.
 */
export async function fetchSourceWithCache(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  // Check cache first
  const cached = getCachedResponse(url);
  if (cached) {
    // Try conditional request if we have caching headers
    if (cached.etag || cached.last_modified) {
      const result = await fetchSource(url, {
        ...options,
        if_none_match: cached.etag,
        if_modified_since: cached.last_modified,
      });

      if (result.http_status === 304) {
        // Not modified - return cached
        return {
          ok: true,
          body: cached.body,
          checksum: cached.checksum,
          from_cache: true,
          etag: cached.etag,
          last_modified: cached.last_modified,
          duration_ms: result.duration_ms,
        };
      }

      // Got new data - update cache
      if (result.ok && result.body) {
        setCachedResponse(
          url,
          result.body,
          result.checksum ?? "",
          result.etag,
          result.last_modified
        );
      }

      return result;
    }

    // No caching headers - return cached directly
    return {
      ok: true,
      body: cached.body,
      checksum: cached.checksum,
      from_cache: true,
      duration_ms: 0,
    };
  }

  // No cache - fetch fresh
  const result = await fetchSource(url, options);

  // Cache successful responses
  if (result.ok && result.body && result.checksum) {
    setCachedResponse(
      url,
      result.body,
      result.checksum,
      result.etag,
      result.last_modified
    );
  }

  return result;
}
