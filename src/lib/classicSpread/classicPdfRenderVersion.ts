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
 *   v3 — financial-period spine: AR_AGING / PFS / PERSONAL_TAX_RETURN periods can no
 *        longer create business spread columns (SPEC-CLASSIC-SPREAD-FINANCIAL-PERIOD-SPINE-1).
 *        A v2 blob rendered before the spine fix (e.g. one still showing a 4/28/2026 AR-aging
 *        column) must be rejected so a fresh v3 render replaces it.
 *   v4 — certification gate: the render now suppresses blocked values (e.g. a derived zero
 *        Total Liabilities), replaces weak personal-income OCR values with certified tax-return
 *        values, strips a false GCF tax-year label, and drops interest-expense-denominated DSCR
 *        rows (SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1). A v3 blob predates these
 *        suppressions and must be rejected.
 */
export const CLASSIC_PDF_RENDER_VERSION = 4;
