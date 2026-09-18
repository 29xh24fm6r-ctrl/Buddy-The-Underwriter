# Borrower-to-package verification

`e2e:borrower-journey` runs the borrower HTTP interfaces, not database/admin shortcuts.
It now exercises guided answers, actual PDF uploads, reload persistence, confirmed
assumptions, authoritative readiness, final generation, and the downloaded ZIP.
The package must contain the five borrower-visible documents from the same run;
all six lender artifacts must exist, and the internal credit memo must remain
inaccessible to the borrower. PDFs and the XLSX workbook are parsed, including
checking for at least one populated worksheet.
This checks file structure, not the accuracy or adequacy of financial content.

## What a pass means

| Result | Exit code | Meaning |
| --- | --- | --- |
| `package_verified` | 0 | The HTTP journey produced and downloaded a structurally valid final borrower package. |
| `failed` | 1 | A request, persistence check, isolation check or package-content check failed. |
| `blocked` | 2 | Prerequisites, authentication, readiness or a bounded generation wait prevented completion. |

A successful package test is **not** proof of browser usability, real identity
verification, completed signatures, submission, lender receipt, or credit approval.
The report always lists these unverified boundaries. Sending an OTP alone never
returns success. The first failed boundary stops the run; it does not continue
making changes or start repeat paid generation attempts.

## Production prerequisites

- Use the server-configured `BORROWER_QA_EMAIL`. The QA-only applications endpoint
  must authorize it, and `package-status` must confirm `isTestDeal: true` before
  any answers or files are changed. A generic borrower session is rejected.
- Supply only deliberately synthetic QA data and parseable source PDFs. The
  source documents must actually support extraction and the financial inputs.
  Never use the old tiny `%PDF...QA test document` placeholder.
- Use the canonical origin: `BUDDY_BASE_URL=https://www.buddysba.com`.
  Authentication requests deliberately do not follow redirects with credentials.
- Do not enable deterministic OTP or mock vendors in production. Do not write
  financial facts, validation results, scores or signatures directly to the DB
  to make this test pass.
- A final-package run can use paid services. Set
  `BUDDY_E2E_ALLOW_GENERATION=true` explicitly for the controlled QA run.

## Run

Run these as separate commands from a secure local shell, using the project's
pinned package-manager/runtime. Never paste codes or cookie values in chat,
PRs or CI logs.

1. Set `BORROWER_QA_EMAIL` and `BUDDY_BASE_URL` in the local environment.
2. Run `pnpm e2e:borrower-journey --send-code`. Exit **2 is expected**: it sent
   a code, not a completed journey. No application is created by this phase.
3. Read the delivered code from the authorized QA mailbox. Supply it through
   the secret environment variable `BUDDY_E2E_OTP`.
4. Set `BUDDY_E2E_SCENARIO` to the private scenario JSON described below and
   set `BUDDY_E2E_ALLOW_GENERATION=true`.
5. Run `pnpm e2e:borrower-journey`. It verifies the existing code without
   requesting a new one. QA application creation correctly accepts HTTP 201.
6. Keep the step report and deal/run IDs. Inspect the first failure in the
   application and runtime logs. Do not treat a blocked run as a release pass.

The runner keeps cookies in memory only. It sends them only to the configured
origin, never to signed storage URLs. Its reports exclude response bodies,
financial values, codes, session cookies and signed URLs.

## Scenario contract

The JSON schema is `scenarioSchema` in `scripts/lib/borrowerJourney.ts`:

- `synthetic`: must be `true`.
- `ownership`: `{ structure: "solo" | "multi", owners: [{ full_name, ownership_pct }] }`.
- `chapters`: optional list of `{ n, data }` using the actual intake endpoint
  contract; `n` is the destination chapter (2 through 5).
- `answers`: ordered `{ questionId, value, confirmed? }` entries for the current
  guided questionnaire. IDs must be actual applicable borrower question IDs.
  The runner reads the current answer before each save to preserve optimistic
  concurrency and validates the confirmed response and subsequent reload.
  For an owner-specific question, supply its stable fact path as `questionId`
  plus the exact `ownerName`. The runner resolves the generated owner ID from
  the live snapshot and refuses missing or ambiguous matches.
- `documents`: at least two `{ path, checklistKey }` entries. Paths are relative
  to the scenario file; filenames must be unique. PDFs are parsed locally
  before authentication or uploads.
- `assumptions`: the reviewed `revenueStreams`, `costAssumptions`,
  `workingCapital`, `loanImpact` and `managementTeam` payload accepted by the
  existing assumptions endpoint. No model-generated facts are auto-confirmed.

The test does not fabricate protected identifiers or automatically clear
readiness. Missing extraction, research, validation or required answers must
remain blockers until completed through the product's supported paths.

### Continue after human input

If a run blocks on protected identifiers or other human-only input, complete
that step through the QA borrower workspace. Request a fresh code, then set
`BUDDY_E2E_DEAL_ID` to that test application's ID and **unset**
`BUDDY_E2E_SCENARIO`. The runner resumes only via the QA-authorized chooser,
does not rewrite any answers, owners, documents or assumptions, and then checks
readiness and the final package. Its report explicitly excludes the initial
capture from the evidence proven by that continuation. It will not automatically
complete identity checks or sign legal forms.

## Remaining live commissioning

At the time this test repair was prepared, production was on main commit
`72ee92d6cded2e20dd646d0021123965a6741d31` (PR #1103). The live browser
connection failed twice before page interaction, and no authorized QA session
was established in this run. Therefore **no production package-generation or
full-path pass is recorded by this change**.

After the HTTP package check succeeds, separately complete and capture evidence
for real browser interaction, authorized identity verification, each applicable
signature, and delivery to an explicitly designated test recipient. This script
never calls seal/submit, initiates identity checks, signs forms, invokes mock
vendor completion endpoints, or releases a synthetic deal to real lenders.

## Regression coverage

`scripts/__tests__/borrowerJourney.test.ts` is discovered automatically by
`test:unit`, which is CI-blocking. It uses simulated HTTP responses to test the
runner itself: isolation, OTP sequencing, HTTP 201, fail-fast behavior, storage
failure, lost answers, blocked readiness, failed/timed-out/stale generation,
missing artifacts, corrupt downloaded files, memo privacy and cookie scoping.
These unit tests are **not** a live borrower journey.
