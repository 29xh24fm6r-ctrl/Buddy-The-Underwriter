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


### Optional AI help isolated from financial actions

The live Ask Buddy test asked for the difference between a prepared package and approval/submission and explicitly prohibited changes. Legacy substring matching interpreted “approved” as confirmation. It returned “Locked in” and changed the assumptions confirmation timestamp at 05:05:48 UTC; saved costs and staffing remained intact. This is included in the same repair rather than merging an incomplete build.

Optional help now sends an explicit, session-bound `guided_help` action to a read-only handler. It loads canonical saved answers, excludes protected identifying fields, uses the budgeted/audited interviewer gateway, and never enters extraction, fact propagation, assumptions confirmation or package generation. Informational/negated legacy text turns use that lane too; voice questions skip generation and fact extraction. Regression coverage exercises non-consent, approval questions, protected-answer exclusion, failed reads, and desktop/mobile Ask Buddy routing.

### Post-1136 production validation and shared financial contract repair

PR #1136 merged at `38a98bd185c61a5895c1e0051952e2987ff68b54` after all CI workflows and Vercel checks passed: 14,603 unit tests, 46 React-server tests, 3,977 package regressions and 36 desktop/mobile journey tests. Production deployment `dpl_F6DwndEQzvaR6VgsZkiNwHqd91g6` matched that SHA.

Two live optional-help tests passed: an approval/submission explanation and a direct request to change the loan amount/confirm assumptions. Answer hashes, financial assumptions timestamps and the $950,000 loan remained unchanged. The help calls used the interviewer gateway successfully. All six uploaded files remained processed; all 88 answers survived reload. Identity, eligibility and lender-sharing gates remained intact.

Full package run `bb5dfd68-59e2-4dc8-8dae-addefeedf3bf` used financial snapshot `8e49ecc8-610e-4b31-baae-dbe5e491945e` (model_v2_package_8). Its credit memo correctly retained canonical LLC identity, owner-linked saved personal statements and downside DSCR 1.44/0.77/0.14. Its feasibility review corrected the initial optimistic Year-1-only draft and passed the full three-year disclosure. The reviewer also recorded the QA fixture's old $330,000 payroll interview description versus newer $150,000 planned-hire schedule as a reconciliation condition; canonical first-year total expenses remained $650,000.

The run failed closed at final financial lineage validation at 05:42:22 UTC. Direct comparisons proved every persisted annual, monthly, opening, sources/uses and balance-sheet figure matched, as did every memo financial field and its sensitivity scenarios. The defect was duplicated payload contracts: the writer included sensitivityScenarios while the validator still hashed the old six-field object. The generic error obscured which artifact differed.

The follow-up uses one typed `packageMemoFinancialPayload` adapter for both memo writing and release validation. Release still compares the entire exact financial payload and now names every mismatched artifact, without exposing values. Regressions cover all three downside years, failed-coverage verdict, missing sensitivity, changes in global cash flow, spread hashes and simultaneous projection drift.

Repeated full testing exhausted the old QA admission headroom (verifier usage 274,498 tokens versus a 500,000 QA limit and 300,000 required headroom). Under the user's authorization for repeated paid full validation, fixed underwriter/verifier daily defaults are increased from 1,000,000 to 2,000,000 each. Per-run limits, 50% QA allocation, atomic reservations and usage ledgers are unchanged. No counters are reset, no QA identity is reclassified, and no financial/review gate is bypassed.
