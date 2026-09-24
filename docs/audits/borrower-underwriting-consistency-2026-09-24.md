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

## Post-merge production validation

PR #1135 merged as `d341cd146432fcdd02a168b25881e6ff470eb9bf` after all CI
checks passed. Production deployment `dpl_55qnY7Tn3GfL2btRCZCkeXaxTJ6g` became
ready with the buddysba.com aliases.

Run `c8ec26cf-12ca-4699-9264-4f51e365508d` correctly stopped before AI because
removing false staffing completeness exposed a genuinely incomplete schedule.
The saved L06 narrative explicitly said detailed staffing remained outstanding.
The recovery UI omitted this actionable operational gap. QA assumptions were
then explicitly changed through the borrower UI: $150,000 aggregate synthetic
beverage payroll beginning month 1, with non-staff fixed costs reduced from
$650,000 to $500,000. Year 1 total expenses remained $650,000; later years differ
because only the fixed-cost portion escalates. This is a test assumption, not
verified franchise evidence or a real borrower correction.

Run `1c148d2f-ba65-4796-a650-52f526904d6e` completed from 04:45:32 to 04:52:41
UTC. New score `d55bc878-2087-4103-82cb-8a3b23309ee7` used LLC, NAICS 722515,
zero operating years, one canonical owner and the saved $350,000 liquidity /
$750,000 net worth. Score 56 is below the marketplace threshold. Size data now
loads correctly; missing receipts and franchise verification remain unresolved.
Identity remains not started, and the sharing consent stays unchecked.
Global cash flow correctly remains undetermined. Feasibility recommendation
now discloses downside DSCR 1.44x / 0.77x / 0.14x and the failed coverage test.

The separate canonical credit-memo adapter still omitted LLC/name/owner PFS
context and the calculated projection downside. Its institutional reviewer
could not find those omissions because both consumers received the same
incomplete adapter payload. The next consolidated build freezes saved borrower
and owner-statement evidence in the memo snapshot, passes projection scenarios
to both generator and reviewer, and extends the mechanical disclosure audit to
income and repayment sections. Statements remain explicitly unverified and do
not supply ongoing guarantor income or certify historical/rate stress.

Recovery now targets actual staffing and management assumption editors, preserves
franchise verification requirements, explains payroll double-counting, and
replaces old findings with current check results. Package financial, publication
format and review versions invalidate cached output from the incomplete adapter.
