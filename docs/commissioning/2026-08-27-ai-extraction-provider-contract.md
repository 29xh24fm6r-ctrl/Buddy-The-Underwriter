# AI extraction provider-contract convergence — 2026-08-27

## Production evidence

- Production document-worker invocations returned valid Gemini JSON without the
  required `facts` key on both attempts. The extraction client rejected those
  responses only after the provider work completed.
- OCR logged `modelCandidates: ["gemini-2.0-flash", "gemini-3.1-flash-lite"]`
  and paid a guaranteed 404 against the retired configured model before reaching
  the supported registry model.
- The separate missing `reserve_ai_gateway_tokens` RPC remains a deployment/
  database blocker. This repair does not weaken the AI gateway's fail-closed
  budget authority.

## Root causes

- The Vertex response schema constrained only the root to `object`, while the
  client and prompt required `facts` and `metadata`.
- Environment overrides were always attempted before the canonical model even
  when they named a provider generation already retired from this OCR lane.

## Repair

- Require `facts` and `metadata` at the provider controlled-generation boundary
  while preserving optional evidence and document-specific nested fact keys.
- Exclude only known-retired Gemini 1.5/2.0 overrides before admission; preserve
  unknown/new operator overrides and the canonical `MODEL_OCR` fallback.
- Add behavioral regression coverage for the exact request schema and for
  zero-call rejection of the retired production override.

## Safety and verification checkpoint

- No schema, database row, credential, environment variable, dependency, prompt,
  parser, deterministic fallback, or production data is changed.
- Required GitHub CI and the exact-head Vercel preview must be green before merge
  recommendation.
- Post-merge closure requires an authorized document fixture and production-log
  confirmation that the retired model is absent and Gemini responses contain the
  required top-level contract.
- Direct database verification remains blocked until a verified Buddy-owned
  Supabase connection is available. The non-Buddy connection remains untouched.
