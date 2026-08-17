# Vendor doc — Google (Gemini)

**Status: APPROVED** — Matt approved Google/Gemini for borrower-NPI processing
on 2026-08-17. The AI gateway (`src/lib/ai/gateway.ts`) permits
`npiTagged: true` requests to this provider while the safeguards in this record
remain in force. This gate applies only to the gateway's new code path
(`generator`/`interviewer` roles); it does not affect the 18 pre-existing
direct Gemini call sites this spec doesn't touch (see the SPEC-M1 §0
inventory) — those are already in production today.

## Role in the gateway

- `generator` (primary) — default narrative/draft generation
- `interviewer` (primary) — borrower-facing conversational intake (M5)
- `generator` failover target: none currently routes back to Google as a
  fallback (OpenAI is generator's failover)

## Endpoint / API surface

- **Gemini Developer API** (`generativelanguage.googleapis.com`) — used by
  `src/lib/ai/providers/google.ts` via `GEMINI_API_KEY`. This is the
  consumer/developer API tier, not Vertex AI.
- Region: the Gemini Developer API does not offer the same explicit
  regional-residency controls as Vertex AI. **Needs verification**: confirm
  with Google/legal whether the Developer API tier meets our "US-region
  only" requirement, or whether borrower-NPI traffic through the gateway
  should instead route through Vertex AI (already used elsewhere in this
  repo, e.g. `src/lib/financialSpreads/extractors/gemini/geminiClient.ts`),
  which does support regional pinning (`us-central1`, `us`, etc. — see
  `src/lib/ai/vertexLocation.ts`).

## No-training terms

Per Google's published Service Terms, Google does not use API customer data
to train or fine-tune models without prior permission — this applies to
managed models on both GA and pre-GA tiers.
[Google Cloud: Gemini Enterprise zero data retention](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention)

## Zero Data Retention (ZDR)

Google offers an approved Zero Data Retention program for the Gemini
Developer API: once approved for a project, prompts/responses and
identifiable metadata are cleared prior to logging.
[Gemini API ZDR docs](https://ai.google.dev/gemini-api/docs/zdr)

Conditions to actually achieve ZDR (not automatic):
- Data caching must be disabled.
- Session resumption (Gemini Live API) must stay off — it's off by default
  but can be re-enabled per-request; must not be enabled for NPI traffic.
- **Grounding with Google Search is NOT zero-retention** — Google stores
  prompts/context/output for 30 days when grounding is used, with no way to
  disable it. `src/lib/rates/indexRates.ts` uses `google_search` grounding
  today for rate lookups (not borrower NPI) — flagging so any future
  NPI-adjacent use of grounded search is caught before it ships.

## Permitted data categories

- Non-NPI business facts (NAICS descriptions, generic loan terminology): OK
  today, matches current `naics-suggest` PoC migration.
- Borrower NPI (SSN, income, tax data, PII): approved for gateway processing,
  subject to no grounded-search tool use and continued enforcement of the
  platform's retention and no-training controls.

## Continuing controls

1. Confirm ZDR is actually enrolled/approved for our Google Cloud project
   (not just theoretically available).
2. Decide Developer API vs. Vertex AI for any NPI-tagged gateway traffic,
   given Vertex's clearer regional controls.
3. Confirm no grounding tool is ever attached to an NPI-tagged gateway call.

Sources: [Gemini Enterprise zero data retention](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention) · [Gemini API ZDR docs](https://ai.google.dev/gemini-api/docs/zdr)
