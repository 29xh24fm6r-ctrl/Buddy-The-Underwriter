# Vertex AI endpoint-class production repair

Date: 2026-08-27

## Scope

Buddy The Underwriter only. This audit used the canonical repository and the
Vercel project serving www.buddysba.com. No other product repository,
database, deployment, or infrastructure was inspected or modified.

## Production evidence

Production document extraction constructed
`https://us-aiplatform.googleapis.com` and failed with
`HTTP 400 Invalid hostname`. The Google provider used one regional hostname
template for every configured Vertex location.

The same review separately confirmed the known missing
`reserve_ai_gateway_tokens` RPC. That database blocker is not changed by this
source-only repair.

## Standards correction

PR 932 stopped the invalid-host failure by treating `us`, `eu`, and
`global` as invalid and substituting `us-central1`. Current Google
documentation confirms that those values are valid location classes with
different hostnames:

- regional: `<region>-aiplatform.googleapis.com`
- US/EU multi-region: `aiplatform.<location>.rep.googleapis.com`
- global: `aiplatform.googleapis.com`

The operator-selected location and the `/locations/<location>` path must
remain paired. Silently substituting a single region can change an intentional
availability or jurisdictional-boundary configuration.

Official evidence:

- https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/request-response-logging

## Repair

- Preserve valid regional, `us`, `eu`, and `global` location values.
- Reject blank, malformed, and zonal values to the safe `us-central1`
  default.
- Select the documented hostname for each endpoint class.
- Use the same normalized location in the hostname decision and request path.
- Add runtime and source guards for every endpoint class and the exact
  production regression.

## Verification plan

- Focused Vertex location and endpoint-host tests.
- Repository typecheck, lint, architecture/security/schema guards, complete
  unit and research suites, build, and public browser smoke.
- Exact-head Vercel preview, build-SHA match, and runtime-log inspection.

## Remaining production closure

After merge and deployment, requeue one authorized failed document-extraction
fixture and confirm no request targets `us-aiplatform.googleapis.com`.
Document processing also remains blocked until the already-reviewed PR 917
migration is applied through a verified Buddy-owned Supabase connection.
