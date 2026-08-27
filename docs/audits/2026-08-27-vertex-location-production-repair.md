# Vertex AI regional endpoint production repair

Date: 2026-08-27

## Scope

Buddy The Underwriter only. This audit used the canonical repository and the
Vercel project serving www.buddysba.com. No other product repository,
database, deployment, or infrastructure was inspected or modified.

## Production evidence

The two-hour production runtime review found document extraction requests
constructing `https://us-aiplatform.googleapis.com` and failing with
`HTTP 400 Invalid hostname`. The same review separately confirmed the known
missing `reserve_ai_gateway_tokens` RPC; that database blocker is not changed
by this source-only repair.

## Root cause

`getVertexLocation()` trusted `GOOGLE_CLOUD_LOCATION` and
`GOOGLE_CLOUD_REGION` verbatim. Buddy's Google provider interpolates the
returned value into a regional hostname. A multi-region value such as `us`
therefore produced an invalid regional endpoint instead of the supported
`us-central1-aiplatform.googleapis.com` endpoint.

## Repair

- Centralize pure location normalization and resolution.
- Accept trimmed, case-normalized regional identifiers.
- Fail blank, malformed, zonal, multi-region, and global values safely to
  Buddy's supported `us-central1` deployment.
- Preserve `GOOGLE_CLOUD_LOCATION` precedence and blank-value fallback to
  `GOOGLE_CLOUD_REGION`.
- Add runtime unit coverage plus source guards proving every server lookup is
  validated.

## Verification plan

- Focused Vertex location tests.
- Repository typecheck, lint, architecture/security/schema guards, complete
  unit and research suites, build, and public browser smoke.
- Exact-head Vercel preview, build-SHA match, and runtime-log inspection.

## Remaining production closure

After merge and deployment, requeue one authorized failed document-extraction
fixture and confirm no request targets `us-aiplatform.googleapis.com`.
Document processing also remains blocked until the already-reviewed PR 917
migration is applied through a verified Buddy-owned Supabase connection.
