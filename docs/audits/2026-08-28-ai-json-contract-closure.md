# Buddy Continuous Commissioning — AI JSON Contract Closure

Date: 2026-08-28  
Scope: Buddy The Underwriter only (`29xh24fm6r-ctrl/Buddy-The-Underwriter`, `www.buddysba.com`)  
Excluded: Buddy LOS and every other LOS/CRM product.

## Continuation state

- PR 878 was merged on 2026-08-26.
- Complete seal → marketplace → lender-delivery transactional closure still requires an authorized Golden Trident fixture and a verified Buddy-owned Supabase connection.
- Production remained on commit `369044c8ffef4ce8b714e1f277f62599511f583e` when this arc began, returned HTTP 200, and showed no current error/fatal runtime cluster.
- PRs 936, 937, and 938 remained open, green, and independent. This arc does not modify their files.

## Audited system

AI gateway structured-output contracts across all live roles that can reach OpenAI, including Google → OpenAI generator failover and the OpenAI-only structurer role.

## Findings

1. Advanced credit-memo generation supplied `{ type: "object" }` as a response schema. The OpenAI adapter always enables strict JSON Schema for any supplied schema, so a Google failure could cause OpenAI to reject the request before generating a memo. Buddy then returned a hard fallback stub rather than a real advanced memo.
2. Interview fact suggestion supplied a strict schema with an unconstrained `field_value: {}` and omitted two declared properties from `required`. That contract cannot faithfully represent the supported dynamic fact values and is incompatible with OpenAI strict structured output.
3. Form 1919 use-of-proceeds classification declared `description` but did not require it. OpenAI strict schemas require every declared property to be required, so admission could fail and silently collapse all proceeds into the generic Other bucket.

## Root cause

The gateway exposed only one JSON control: `responseSchema`. Some callers need strict schema enforcement, while others have legitimate dynamic keys, optional fields, or JSON-typed values and already perform authoritative caller-side validation. Treating both cases as strict schema made valid cross-provider failover impossible.

## Repair

- Added mutually exclusive `responseJsonObject` gateway/provider support.
- Google JSON-object mode requests `application/json` without a response schema.
- OpenAI JSON-object mode uses native `{ type: "json_object" }`.
- Strict-schema behavior remains unchanged when `responseSchema` is supplied.
- Credit-memo generation now uses JSON-object mode and retains its Zod validation plus repair retry.
- Interview fact suggestion now uses JSON-object mode and locally enforces allowed keys, required values, safe text, and bounded confidence.
- Form 1919 classification now requires nullable `description`, making the nested strict schema valid.

## Regression coverage

- Provider request-body tests for Google JSON-object mode.
- Provider request-body tests for OpenAI JSON-object and strict-schema precedence.
- Credit-memo Google-failure → OpenAI-success failover regression.
- Interview dynamic-value and allowed-key validation regression.
- Form 1919 nested strict-schema regression.

## Verification state

Validation completed on code head `6e215996ec5644b4a8c5223206ed5df2de01a48d`:

- 13,345 tests: 13,336 passed, 0 failed, 9 skipped.
- React-server tests: 18 passed, 0 failed.
- Research golden set: 7 passed, 0 failed, 13 known placeholders skipped.
- CI, Build Check, Secret Scan, typecheck, lint, architecture, safety, schema-select, drift, polling, Never-500, and public Playwright passed.
- Authenticated Playwright was explicitly skipped because credentials were unavailable.
- Exact-head Vercel deployment `dpl_FriJaVwtWLZdp58MxfNdrhyRfpZR` reached READY, returned HTTP 200, served `x-buddy-build: 6e215996ec5644b4a8c5223206ed5df2de01a48d`, and had no error/fatal runtime logs.

The final documentation-only evidence commit must retain the same code tree and complete GitHub/Vercel checks before merge.

## Remaining risks and next targets

- PR 937 owns the overlapping financial-spread extraction schema and must remain the place for that provider-contract repair.
- Transactional document extraction needs an authorized Buddy fixture after the relevant PRs deploy.
- The missing `reserve_ai_gateway_tokens` RPC and direct database evidence require a verified Buddy-owned Supabase connection. The available non-Buddy connection must not be accessed.
- Golden Trident’s complete delivery ceremony still requires explicit fixture authorization.
