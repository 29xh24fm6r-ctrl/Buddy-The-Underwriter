/**
 * SPEC-BIE-COMMITTEE-ACTION-CENTER-AND-OFFICIAL-PDF-CAPTURE-1 — Phase 1
 *
 * Pure classification of an official/public source capture. Decides whether we
 * hold a USABLE official capture (vs only a Buddy-generated receipt), its format,
 * a banker-facing status, and limitations — including the Secretary-of-State /
 * business-registry "this is a search form, not the entity detail page" rule.
 *
 * No I/O, no DB, deterministic given inputs. NEVER affects committee scoring,
 * eligibility, the gate, or review semantics — it only describes provenance.
 */

export type OfficialCaptureFormat = "none" | "html" | "pdf";

export type OfficialCaptureStatus =
  | "captured" // a usable official capture is stored
  | "search_form_only" // SOS/registry search form, not the entity detail/result page
  | "not_retained" // collected, but the fetched content was not persisted (e.g. legacy snapshot)
  | "fetch_failed" // the fetch did not succeed
  | "none";

export type OfficialCaptureInput = {
  sourceType?: string | null;
  sourceUrl?: string | null;
  contentType?: string | null;
  /** True when we actually hold the captured bytes/text for this source. */
  hasContent: boolean;
  /** Whether the underlying snapshot fetch succeeded (defaults to true). */
  fetchOk?: boolean;
};

export type OfficialCaptureClassification = {
  official_capture_available: boolean;
  official_capture_format: OfficialCaptureFormat;
  official_capture_status: OfficialCaptureStatus;
  official_capture_limitations: string[];
};

// Path/query tokens that indicate a registry SEARCH form rather than an entity
// detail/result page (e.g. Oklahoma SOS `corpInquiryFind.aspx`).
const SEARCH_FORM_PATTERNS: RegExp[] = [
  /corpinquiryfind/i,
  /businesssearch/i,
  /\binquiry\b/i,
  /\bsearch\b/i,
  /\bfind\b/i,
  /\blookup\b/i,
  /search\.aspx/i,
];

const REGISTRY_SOURCE_TYPES = new Set(["secretary_of_state", "business_registry"]);

export const SEARCH_FORM_LIMITATION =
  "Captured page is a Secretary of State / business-registry search form, not the entity detail/result page. Attach the actual result page before recommending committee-grade.";

/** Heuristic: does this URL look like a registry search form (not a detail page)? */
export function isLikelySearchFormUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? "");
  if (!raw) return false;
  let pathAndQuery = raw;
  try {
    const parsed = new URL(raw);
    pathAndQuery = `${parsed.pathname}${parsed.search}`;
  } catch {
    /* fall back to the raw string */
  }
  return SEARCH_FORM_PATTERNS.some((re) => re.test(pathAndQuery));
}

/** Is the captured content a native PDF (by content-type or URL extension)? */
export function isPdfContentType(
  contentType: string | null | undefined,
  url?: string | null,
): boolean {
  if (/application\/pdf/i.test(String(contentType ?? ""))) return true;
  return /\.pdf(\?|#|$)/i.test(String(url ?? ""));
}

/**
 * Classify a capture. Order matters:
 *   1. registry search-form URL  → never "available" (must attach detail page)
 *   2. fetch failed              → fetch_failed
 *   3. no content retained       → not_retained (receipt only)
 *   4. content present           → captured (html | pdf)
 */
export function classifyOfficialCapture(
  input: OfficialCaptureInput,
): OfficialCaptureClassification {
  const isRegistry = REGISTRY_SOURCE_TYPES.has(String(input.sourceType ?? ""));
  const pdf = isPdfContentType(input.contentType, input.sourceUrl);
  const contentFormat: OfficialCaptureFormat = pdf ? "pdf" : "html";

  if (isRegistry && isLikelySearchFormUrl(input.sourceUrl)) {
    return {
      official_capture_available: false,
      // We may still have captured the form's bytes; surface the format so the
      // viewer can show *what* was captured, but never mark it available.
      official_capture_format: input.hasContent ? contentFormat : "none",
      official_capture_status: "search_form_only",
      official_capture_limitations: [SEARCH_FORM_LIMITATION],
    };
  }

  if (input.fetchOk === false) {
    return {
      official_capture_available: false,
      official_capture_format: "none",
      official_capture_status: "fetch_failed",
      official_capture_limitations: [
        "Source fetch did not succeed; no official capture was stored. Only a Buddy receipt is available.",
      ],
    };
  }

  if (!input.hasContent) {
    return {
      official_capture_available: false,
      official_capture_format: "none",
      official_capture_status: "not_retained",
      official_capture_limitations: [
        "The fetched source content was not retained for this capture; only a Buddy receipt is available.",
      ],
    };
  }

  return {
    official_capture_available: true,
    official_capture_format: contentFormat,
    official_capture_status: "captured",
    official_capture_limitations: [],
  };
}
