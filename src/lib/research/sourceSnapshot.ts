/**
 * SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1
 *
 * Borrower official-website fetch/snapshot connector — the FIRST real evidence
 * connector. The shared fetchSource layer is registry-allowlisted (it blocks
 * arbitrary borrower domains), so this is a dedicated, self-limited fetch of the
 * borrower's OWN site: HTTPS-normalized, domain-matched, size + time capped,
 * sha256-hashed, never throws.
 *
 * No `server-only` so the pure normalize/extract helpers are unit-testable; the
 * fetch uses global fetch (mockable in tests).
 */

import { createHash } from "crypto";
import { normalizeDomain } from "./sourcePolicy";

export type BorrowerWebsiteSnapshot = {
  ok: boolean;
  source_url: string;
  status: "collected" | "failed";
  http_status: number | null;
  content_hash: string | null;
  content_type: string | null;
  title: string | null;
  byte_size: number | null;
  error: string | null;
};

const MAX_BYTES = 1_500_000; // 1.5MB
const TIMEOUT_MS = 12_000;

/** Normalize a raw website value to an https URL, or null if unusable. */
export function toHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (s.length === 0) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}

/** Extract the <title> text from an HTML string, capped. */
export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = m[1].replace(/\s+/g, " ").trim();
  return t.length > 0 ? t.slice(0, 300) : null;
}

/**
 * Fetch + snapshot the borrower's official website. Only fetches when the URL's
 * host matches the borrower domain (defense against snapshotting an unrelated
 * site). Never throws — returns status "failed" with an error on any problem.
 */
export async function fetchBorrowerWebsiteSnapshot(
  rawWebsite: string | null | undefined,
  borrowerDomain?: string | null,
): Promise<BorrowerWebsiteSnapshot> {
  const url = toHttpsUrl(rawWebsite);
  const base: BorrowerWebsiteSnapshot = {
    ok: false, source_url: url ?? String(rawWebsite ?? ""), status: "failed",
    http_status: null, content_hash: null, content_type: null, title: null, byte_size: null, error: null,
  };
  if (!url) return { ...base, error: "no usable website URL" };

  // Domain guard: only snapshot the borrower's own site.
  const want = normalizeDomain(borrowerDomain ?? rawWebsite ?? null);
  const got = normalizeDomain(url);
  if (want && got && got !== want && !got.endsWith(`.${want}`)) {
    return { ...base, error: `domain mismatch (${got} != ${want})` };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "BuddyTheUnderwriter/1.0 (institutional lending research)",
        Accept: "text/html,application/xhtml+xml,*/*",
      },
    });
    const contentType = res.headers.get("content-type");
    const body = await readCapped(res, MAX_BYTES);
    const hash = createHash("sha256").update(body).digest("hex");
    const okStatus = res.status >= 200 && res.status < 300;
    return {
      ok: okStatus,
      source_url: url,
      status: okStatus ? "collected" : "failed",
      http_status: res.status,
      content_hash: hash,
      content_type: contentType,
      title: extractTitle(body),
      byte_size: body.length,
      error: okStatus ? null : `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { ...base, source_url: url, error: e?.name === "AbortError" ? "timeout" : (e?.message ?? "fetch_error") };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1
 *
 * Generic capped fetch + snapshot for a banker-supplied source URL (manual URL
 * connector). Same size/time caps + sha256 hashing as the borrower-website
 * connector, but NO domain guard — the URL is an explicit, human-attached source
 * for a committee task (not autonomous crawling). Never throws.
 */
export async function fetchUrlSnapshot(
  rawUrl: string | null | undefined,
): Promise<BorrowerWebsiteSnapshot> {
  const url = toHttpsUrl(rawUrl);
  const base: BorrowerWebsiteSnapshot = {
    ok: false, source_url: url ?? String(rawUrl ?? ""), status: "failed",
    http_status: null, content_hash: null, content_type: null, title: null, byte_size: null, error: null,
  };
  if (!url) return { ...base, error: "no usable source URL" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "BuddyTheUnderwriter/1.0 (institutional lending research)",
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*",
      },
    });
    const contentType = res.headers.get("content-type");
    const body = await readCapped(res, MAX_BYTES);
    const hash = createHash("sha256").update(body).digest("hex");
    const okStatus = res.status >= 200 && res.status < 300;
    return {
      ok: okStatus,
      source_url: url,
      status: okStatus ? "collected" : "failed",
      http_status: res.status,
      content_hash: hash,
      content_type: contentType,
      title: extractTitle(body),
      byte_size: body.length,
      error: okStatus ? null : `HTTP ${res.status}`,
    };
  } catch (e: any) {
    return { ...base, source_url: url, error: e?.name === "AbortError" ? "timeout" : (e?.message ?? "fetch_error") };
  } finally {
    clearTimeout(timeout);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { reader.cancel(); break; }
    chunks.push(value);
  }
  const combined = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    if (off + c.length > combined.length) { combined.set(c.subarray(0, combined.length - off), off); break; }
    combined.set(c, off); off += c.length;
  }
  return new TextDecoder().decode(combined);
}
