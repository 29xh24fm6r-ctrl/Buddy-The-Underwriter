# Borrower underwriting consistency

Production verification after PR #1134 completed AI preparation, but its score
lost the canonical LLC, NAICS, startup/franchise and personal-statement inputs.
The size-standard dataset was valid locally but unavailable inside production.
The recommendation also omitted the later-year downside coverage collapse.

This build connects scoring to the same borrower context used by package
narratives and the same explicit business-stage detector used by the financial
engine. Canonical owner IDs resolve personal financial statements without a
legacy application row. A declaration of franchise intent does not establish
verified franchise eligibility. Missing identity/certification remains an
outstanding requirement, and actual ineligibility remains a failure.

The score uses the minimum saved three-year downside DSCR. A deterministic
publication check requires decision sections to disclose all three years and
the saved threshold failure. Sensitivity labels now describe the actual growth
and COGS adjustments; projection calculations are unchanged.

Global cash flow distinguishes incomplete guarantor schedules from zero
coverage. Startup business cash flow uses the projected first-year basis and
labels it accordingly. Historical personal income is not silently assumed to
continue after opening. Unknown staffing is not described as no hiring.

The reference JSON is explicitly included in all traced server functions;
loader failures log the underlying operational reason. Financial snapshot and
package format versions invalidate pre-repair artifacts, and review rules v3
invalidate cached verdicts that lacked the new disclosure check.

Validation requires canonical-only startup, owner isolation, unknown financial
inputs, missing versus negative eligibility evidence, multi-year recommendation
coverage, and unchanged identity/consent/release protection. Production must
verify dataset availability and persisted score inputs after deployment.
The synthetic deal may still require borrower information or fail substantive
credit criteria; tests must not change evidence to manufacture approval.
