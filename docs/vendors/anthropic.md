# Vendor doc — Anthropic (Claude)

**Status: APPROVED** — Matt approved Anthropic/Claude for borrower-NPI
processing on 2026-08-17. The AI gateway (`src/lib/ai/gateway.ts`) permits
`npiTagged: true` requests to this provider while the safeguards in this
record remain in force.

Net-new vendor: no prior Anthropic usage exists anywhere in this repo
(confirmed via `grep -rn "ANTHROPIC_API_KEY\|@anthropic-ai" src/` returning
zero production hits at SPEC-M1 §0 time). No commercial agreement with
Anthropic is assumed to exist yet — **Matt must confirm one is in place**
before this can move to APPROVED, separate from the technical terms below.

## Role in the gateway

- `verifier` (sole role, no failover) — cross-checks Gemini/OpenAI-generated
  narratives against deterministic facts (`src/lib/ai/verify.ts`).
  Invariant #4 ("roles, not committees") means this is the only verifier;
  it never runs in parallel with a second independent check on the same
  artifact.

## Endpoint / API surface

- Anthropic Messages API (`api.anthropic.com/v1/messages`), called directly
  via fetch in `src/lib/ai/providers/anthropic.ts` — no `@anthropic-ai/sdk`
  dependency, per Gateway Invariant #3.
- Region: **needs verification**. Anthropic's standard API does not
  document a customer-selectable US-only region the way Vertex AI does;
  confirm with Anthropic (or via AWS Bedrock/GCP Vertex as an alternative
  access path, both of which offer regional controls) before any NPI
  traffic is approved.

## No-training terms

Under Anthropic's Commercial Terms of Service (Claude for Work, Enterprise,
API, and cloud-marketplace variants — not the consumer Claude.ai tier),
customer inputs/outputs are not used to train models, and retained data is
never used for training without express permission.
[Claude Platform: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

## Zero Data Retention (ZDR)

Anthropic offers a Zero Data Retention agreement for qualifying enterprise
API customers — under ZDR, inputs/outputs are not stored beyond what's
needed for abuse screening. Without ZDR, standard commercial API retention
defaults to deletion within 30 days (longer for abuse/legal-hold
exceptions).
[Claude Platform: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

**Needs verification**: whether our account qualifies for ZDR and whether
it has actually been requested/enabled — "offered" is not the same as
"in place."

## Permitted data categories

- Synthetic/fixture facts and drafts (used in this spec's own tests): OK
  today.
- Real borrower narrative drafts with no NPI (e.g. a narrative that only
  references facts already public or non-identifying): candidate for
  interim approval — Matt's call.
- Borrower NPI: approved for gateway verification and release review, subject
  to continued commercial no-training and retention controls.

## Continuing controls

1. Confirm a commercial (not consumer) Anthropic agreement exists or is
   being executed.
2. Confirm ZDR eligibility/enrollment status for our account.
3. Confirm a US-region-only access path (direct API vs. Bedrock/Vertex).

Sources: [Claude Platform: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
