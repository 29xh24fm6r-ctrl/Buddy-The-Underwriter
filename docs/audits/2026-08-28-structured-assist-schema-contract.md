# Structured-assist provider schema convergence — 2026-08-28

## Scope

Buddy The Underwriter only. Evidence came from the canonical repository and the
Vercel production deployment serving www.buddysba.com. No other product
repository, database, deployment, or infrastructure was inspected or modified.

## Production evidence

A production `BUSINESS_TAX_RETURN` document reached structured assist after OCR.
The primary Google attempt failed and the generator role correctly advanced to
its OpenAI fallback, but OpenAI rejected the request with HTTP 400 before
generation:

`Invalid schema for response_format 'gateway_result': ... 'additionalProperties'
is required to be supplied and to be false.`

Buddy then fell back to OCR regex and the surrounding smart router reported
completion, so the provider-contract failure degraded extraction quality without
failing the overall document job.

## Root cause

`geminiFlashStructuredAssist.ts` supplied only `{ type: "object" }` as its
provider response schema. Gemini accepts that unconstrained placeholder, but
OpenAI's strict structured-output mode requires every object node to reject
undeclared properties and every declared property to be required. The gateway's
Google adapter already removes `additionalProperties` recursively from its own
copy, so the caller can safely provide one OpenAI-closed schema to both provider
steps.

## Repair

- Define the complete provider response contract beside the versioned Zod
  acceptance schema.
- Close the root, entity, normalized-money, and form-field object nodes.
- Require every declared property while preserving the prompt's existing entity
  and form-field shapes.
- Send the same contract through the Google primary and OpenAI fallback.
- Add a behavioral failover test that captures the exact OpenAI request and
  recursively verifies the strict-object invariants.

## Safety and verification

- No database, migration, credential, environment, provider configuration,
  deterministic extractor, production data, or dependency changes.
- Google receives its existing OpenAPI-subset copy because the provider adapter
  strips `additionalProperties`; OpenAI receives the closed original.
- The advisory structured-assist fallback remains non-blocking.
- Required GitHub CI and the exact-head Vercel preview must be green before a
  merge recommendation.

## Remaining closure

After merge, production closure requires one authorized document-extraction
fixture that exercises Google failure and OpenAI fallback. Direct database
verification and the missing AI-governance RPC remain blocked until a verified
Buddy-owned Supabase connection is available. The non-Buddy connection was not
accessed.
