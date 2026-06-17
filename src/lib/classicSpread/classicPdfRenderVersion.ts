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
 *   v5 — render-consistency fix (code-only, no fact change): liability-derived ratios
 *        (Debt/Worth, Debt/Tangible Net Worth, Total Liabilities/Total Assets, Total
 *        Liabilities Growth %) now blank when the visible TOTAL LIABILITIES value is
 *        unavailable instead of rendering 0.00 / -100%, and the GCF coverage band falls back
 *        to UNKNOWN when globalDscr is blank (no false "TIGHT — DSCR 1.00x–1.25x"). A v4 blob
 *        predates these and must be rejected so the fixed renderer replaces it.
 *   v6 — line-accuracy / completion audit: the render now includes a "Spread Accuracy &
 *        Completion Audit" page (statement footing + missing-line detection) and persists the
 *        audit into certificationAudit.spreadAccuracy; the narrative leads with a data-reliability
 *        caveat when blocker findings exist (SPEC-CLASSIC-SPREAD-LINE-ACCURACY-COMPLETION-AUDIT-1).
 *        A v5 blob lacks the audit page and must be rejected.
 *   v7 — system-hardening audit 2: bank-scoped loader, business-vs-personal fact separation,
 *        Net AR normalization, liability derivation hierarchy (direct→component→balancing), UCA
 *        net-AR/current-liability deltas, true-zero rendering (0 ≠ blank), and a fail-closed
 *        "NOT CERTIFIED" banner (SPEC-CLASSIC-SPREAD-SYSTEM-HARDENING-AUDIT-2). Output changes
 *        materially, so a v6 blob must be rejected.
 *   v8 — v7 follow-up: Executive Financial Statement uses the shared liability hierarchy (so its
 *        TOTAL LIABILITIES matches the Detailed Balance Sheet), the audit page sanitizes finding
 *        text to plain ASCII (no Δ/≠/→ corrupted glyphs), and the narrative clamps strong-positive
 *        conclusions under a BLOCKER (SPEC-CLASSIC-SPREAD-V7-FOLLOWUP-1). A v7 blob must be rejected.
 *   v9 — statement truth resolver: the Spread Accuracy Audit now arbitrates candidate facts per
 *        period (rejected/suspect source values like a wrong direct SL_TOTAL_EQUITY or a TCA that
 *        equals AR-only, implied missing components, 1120 gross-profit conflicts) and shows those
 *        findings (SPEC-CLASSIC-SPREAD-STATEMENT-TRUTH-RESOLVER-1). A v8 blob lacks them.
 *   v10 — resolver render wiring: the rendered Detailed BS / Executive / Ratios / Cash Flow rows
 *         now derive from the RESOLVED overlay (e.g. 2024 TOTAL NET WORTH = 4,512,938 not
 *         6,800,000; 2025 TOTAL CURRENT ASSETS = 3,133,066 not 2,393,922), not just the audit
 *         findings (SPEC-CLASSIC-SPREAD-TRUTH-RESOLVER-RENDER-WIRING-1). A v9 blob renders the
 *         pre-resolver values and must be rejected.
 *   v11 — resolver-aware audit de-dup: the audit no longer emits stale generic footing blockers for
 *         rows the resolver already corrected + flagged (e.g. 2024 TOTAL NET WORTH no longer shows
 *         both unreconciled_total and rejected_source_value); exact-duplicate findings collapse
 *         (SPEC-CLASSIC-SPREAD-AUDIT-RESOLVER-AWARE-DEDUP-1). The audit page content changes.
 *   v12 — blocker batch resolution: liability-side parity (Total Liabilities is never below Total
 *         Current Liabilities; no non-current liabilities → TNCL = 0), explicit 1120 income-line
 *         model, finding→action classification, and a grouped action summary rendered as "top
 *         blocker actions" instead of every finding (SPEC-CLASSIC-SPREAD-BLOCKER-BATCH-RESOLUTION-1).
 *         The rendered liability rows + audit page content change; a v11 blob must be rejected.
 *   v13 — final action de-dup: a TOTAL NON-CURRENT ASSETS unreconciled_total is downgraded to a
 *         warning when the SAME period has a TOTAL CURRENT ASSETS missing_implied_component (same
 *         incomplete asset detail), so the single actionable blocker is the implied-AR request
 *         (SPEC-CLASSIC-SPREAD-V12-FINAL-ACTION-DEDUPE-1). The audit page blocker list shrinks.
 *   v14 — certification status surface: the render now leads the audit page with a "Spread
 *         Certification" status block (certified / preliminary / blocked) derived from the
 *         certification summary — honest roll-up of the certification domains, the post-decision
 *         accuracy findings, and remaining open review actions — so a spread with only the YTD-2026
 *         source-detail request reads "blocked, 1 remaining action" rather than stale 4-blocker
 *         language (SPEC-CLASSIC-SPREAD-CERTIFICATION-GATE-PDF-VERSION-1). A v13 blob lacks the
 *         certification status block and must be rejected.
 *   v15 — per-domain certification lines on the audit page: the certification status block now
 *         prints explicit "Personal income certification: <status>" and "GCF certification:
 *         <status> - <reason>" lines (e.g. "GCF certification: blocked - entity cash flow not
 *         computed") in addition to the aggregate domain counts (SPEC-CLASSIC-SPREAD-PERSONAL-
 *         INCOME-GCF-CERTIFICATION-1 surfaced; BUGFIX-CLASSIC-SPREAD-PDF-DOMAIN-CERTIFICATION-LINES-1).
 *         A v14 blob predates these per-domain lines and must be rejected so the fixed renderer
 *         replaces it.
 *   v16 — GCF entity cash flow compute: when the pipeline did not materialize an entity cash flow
 *         fact, the Global Cash Flow page now COMPUTES entity cash flow from the already-rendered
 *         latest annual income-statement rows (NCADS Standard: EBITDA -> OBI/NI), derives Global Cash
 *         Flow Available + Global DSCR (only when proposed annual debt service is a valid positive
 *         denominator), and labels the figure "Computed from <period> ... (preliminary)". GCF
 *         certification reads "preliminary" instead of "blocked - entity cash flow not computed";
 *         the overall spread stays BLOCKED while the YTD-2026 TCA source-detail action remains
 *         (SPEC-CLASSIC-SPREAD-GCF-ENTITY-CASH-FLOW-COMPUTE-1). A v15 blob lacks the computed entity
 *         cash flow / DSCR lines and must be rejected.
 *   v17 — final audit copy polish (PDF copy only, no math/cert change): the Global Cash Flow page's
 *         coverage band + methodology block + computed-entity-cash-flow note now render plain ASCII
 *         (">=", "->", "-") instead of raw Unicode the core PDF font garbled ("DSCR \"e 1.25x",
 *         "EBITDA !' OBI !' NI"); the methodology heading/rationale and the "NOT CERTIFIED" banners
 *         are sanitized to printable ASCII (SPEC-CLASSIC-SPREAD-FINAL-AUDIT-COPY-POLISH-1). A v16 blob
 *         shows the garbled glyphs and must be rejected so the cleaned renderer replaces it.
 */
export const CLASSIC_PDF_RENDER_VERSION = 17;
