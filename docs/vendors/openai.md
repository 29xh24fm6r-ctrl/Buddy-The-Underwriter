# Vendor doc — OpenAI

**Status: PENDING** — Matt to review and flip `VENDOR_NPI_APPROVAL.openai`
in `src/lib/ai/vendorApproval.ts` to `APPROVED` once satisfied. Until then,
the AI gateway (`src/lib/ai/gateway.ts`) refuses any `npiTagged: true`
request to this provider — the `structurer` role runs only on synthetic or
non-NPI content in the meantime.

Note: OpenAI is **not** a net-new vendor to this repo overall — the
`openai` npm package and `OPENAI_API_KEY` are already in production use
outside the gateway (`src/lib/ai/openaiClient.ts`,
`src/lib/gatekeeper/classifyWithOpenAI.ts`, `src/lib/retrieval/
retrievalCore.ts`, `src/ai/orchestrator/run.ts`, and `src/lib/ai/
orchestrator.ts` — see SPEC-M1 §0 inventory). This doc and the PENDING
status govern only the **gateway's own new code path**
(`src/lib/ai/providers/openai.ts`, fetch-based, no SDK) — it is a fresh
review, not a statement that OpenAI has never handled real data in this
system. Whether the existing (non-gateway) OpenAI call sites already
handle borrower NPI under acceptable terms is a separate question, out of
scope for this spec, and worth Matt confirming independently since it
predates this formal vendor-doc process.

## Role in the gateway

- `structurer` (sole role by default) — maps LLM-residue fields into
  strict JSON via Chat Completions' native `json_schema` response format
  (used starting M7, zero-repeat prefill).
- `generator` failover target — if the primary Gemini generator call
  fails, the gateway retries via OpenAI (`src/lib/ai/roleConfig.ts`
  `DEFAULT_CHAINS.generator`).

## Endpoint / API surface

- OpenAI REST API (`api.openai.com/v1/chat/completions`), called directly
  via fetch in `src/lib/ai/providers/openai.ts` — no `openai` SDK
  dependency for the gateway's own traffic, per Gateway Invariant #3.
- Region: **needs verification**. OpenAI's default API does not expose a
  customer-selectable region; Azure OpenAI Service offers region pinning
  (including US-only regions) as an alternative access path if strict
  data-residency is required for NPI-tagged gateway traffic.

## No-training terms

Since March 2023, data sent via the OpenAI API (as distinct from ChatGPT's
consumer product) is not used to train or improve OpenAI's models unless
the customer explicitly opts in. Training-data exclusion is available on
all enterprise accounts regardless of whether Zero Data Retention is also
enabled — the two controls are separate.
[OpenAI: Enterprise privacy](https://openai.com/enterprise-privacy/)

## Zero Data Retention (ZDR)

Default API retention is up to 30 days for inputs/outputs (abuse
monitoring), after which they're deleted unless legally required to be
kept longer. OpenAI offers an opt-in Zero Data Retention option for
eligible endpoints/use-cases — commonly used by regulated-industry
customers — under which prompts/completions are used only to fulfill the
request and then deleted.
[OpenAI: Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)

**Needs verification**: whether ZDR has actually been requested/enabled for
our OpenAI account, and whether the Chat Completions endpoint (used by
`src/lib/ai/providers/openai.ts`) is on OpenAI's current ZDR-eligible
endpoint list.

## Permitted data categories (pending Matt's sign-off)

- Synthetic/fixture data and non-NPI structured-mapping tasks: OK today.
- Borrower NPI flowing through the **gateway's** structurer/generator
  roles: **blocked** until this doc is APPROVED, independent of whatever
  is already happening on the pre-existing non-gateway OpenAI call sites.

## Open items for Matt

1. Confirm ZDR enrollment status and endpoint eligibility for our account.
2. Decide whether Azure OpenAI (region-pinned) should be the access path
   for any NPI-tagged gateway traffic instead of the default API.
3. Separately audit whether the 5 pre-existing non-gateway OpenAI call
   sites already handle NPI, and under what terms — not blocked by this
   gate, but worth closing the loop on.

Sources: [OpenAI: Enterprise privacy](https://openai.com/enterprise-privacy/) · [OpenAI: Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data)
