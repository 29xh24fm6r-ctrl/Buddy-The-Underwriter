/**
 * SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1: CLASSIC_PDF render version.
 *
 * The cached CLASSIC_PDF blob (deal_spreads.rendered_json.pdf_base64) is invalidated by
 * fact changes (canonicalFactsTimestamp) but NOT by code changes. Stamp this version into
 * every rendered blob and reject a cached blob whose version differs — so a renderer/logic
 * change (e.g. VM-driven period list) busts stale blobs without waiting for fact edits.
 *
 * BUMP this whenever the classic-spread loader/renderer output changes materially.
 *   v2 — VM-driven period list + canonical source attribution.
 */
export const CLASSIC_PDF_RENDER_VERSION = 2;
