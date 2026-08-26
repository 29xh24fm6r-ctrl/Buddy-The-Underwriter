# Buddy Continuous Commissioning Ledger

Scope: `29xh24fm6r-ctrl/Buddy-The-Underwriter` and the infrastructure that serves
`www.buddysba.com` only. Buddy LOS and every other LOS/CRM product are explicitly
out of scope.

## 2026-08-26

### Clerk / Supabase identity and privilege boundary

Production checkpoint:

- PR 900 merged as `5c0b0211cfadb12306bf5c6163ee07301804b307`.
- Vercel production deployment `dpl_DPdz2Cr94DipYbznuE4VsLqoMhNt` is READY
  on that exact commit. The public Buddy journey renders successfully.
- No error/fatal runtime entries were recorded for the PR 900 deployment in
  the two-hour verification window.
- Aggregated observability still contains one earlier Golden Trident workflow
  run that correctly blocked publication after institutional review warnings.
  It belongs to an older deployment and is not evidence of a PR 900 regression.

Evidence and root causes:

- The shared server helper created a service-role client but several user routes
  attempted to authenticate with `client.auth.getUser()`. A service-role client
  has no caller session, making usage, screen, tenant-selection, conditions, and
  policy paths return unauthenticated for legitimate Clerk users.
- Two compatibility clients silently fell back from service-role credentials to
  the public anon key. One of them was imported by both a browser component and
  privileged storage code, erasing the client/server trust boundary.
- Buddy's Clerk-to-Supabase JWT used `app_users.id` as `sub`, while current
  bank membership and route authorization use `profiles.id`. RLS therefore
  evaluated a different identity from the canonical banker profile.
- `increment_continue_usage(uuid)` was a public-schema `SECURITY DEFINER`
  function with no fixed search path or EXECUTE revocation. Untrusted API roles
  inherited permission to invoke it for arbitrary UUIDs.
- Its application fallback used a non-existent Supabase `raw()` API and a
  race-prone non-atomic update.

Repair branch: `commissioning/supabase-identity-boundary`.

Repair:

- Add canonical Clerk-to-profile and Clerk-to-deal API contexts. Privileged
  queries are exposed only after authentication, UUID actor resolution, bank
  resolution, and explicit deal-bank comparison.
- Rewire all twelve proven sessionless-auth paths to those contexts, including
  tenant selection, usage, screen ownership/continuation, conditions, and policy.
- Preserve UUID audit provenance with `profiles.id`; never write Clerk text IDs
  into UUID columns.
- Make privileged compatibility clients server-only and service-role-only.
  Browser magic-link auth now imports only the public browser client.
- Make the user-scoped token exchange fail closed and set its RLS subject to
  `profiles.id`, retaining `app_users.id` as a distinct claim.
- Restrict the usage counter function to `service_role`, set a safe search path,
  and remove the broken non-atomic fallback.
- Add static regression guards for every repaired route and boundary.

Verification pending on the branch:

- Focused identity-boundary guard.
- Full unit/evaluation suite, typecheck, build, schema/migration guards, Secret
  Scan, route budget, public browser smoke, and exact-head Vercel preview.
- Post-merge production verification of authenticated usage, tenant chooser,
  conditions/policy, and screen routes requires an authorized Clerk fixture.
- The migration must not be treated as applied until deployment/database evidence
  confirms it. Direct production-row verification remains blocked by the Buddy
  Supabase connector's `-32603` error.


### Post-OTP chooser-cookie signing boundary

Evidence:

- The QA and general borrower application chooser cookies both selected
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` when the service-role secret was unavailable.
  That key is intentionally browser-visible and cannot authenticate a server-only
  post-OTP identity.
- The QA verifier passed attacker-controlled signature buffers of arbitrary length
  to `timingSafeEqual`, which throws when lengths differ instead of returning a
  normal authentication failure.
- Both cookies separately implemented the same HMAC protocol, allowing their
  security behavior to drift.

Repair: PR 900, branch `commissioning/chooser-cookie-signing-boundary`.

- Centralize server-only key selection. Prefer
  `BORROWER_CHOOSER_SIGNING_SECRET`, preserve the existing service-role secret
  as a deployment-safe fallback, never accept public keys, and fail closed in
  production if neither server secret exists.
- Centralize HMAC-SHA256 token signing and strict base64url/64-hex verification.
- Reject malformed lengths and encodings before constant-time comparison.
- Preserve cookie names, payload shapes, ten-minute TTLs, and all session flows.
- Add direct round-trip, tamper, wrong-key, malformed-token, and wiring tests.
- No schema, dependency, permission, provider, or production-data change.

Verification:

- Exact crypto path passed focused Node tests: 2 passed, 0 failed.
- PR 900 is open and mergeable; Vercel preview and required checks are pending.
- GitHub Actions had not created workflow runs for the head while GitHub's
  confirmed Actions incident remained active.

Open checkpoints:

1. PR 899 remains open and mergeable; its required Actions checks are externally
   blocked.
2. PR 897 merged on 2026-08-26. Its schema-classification change is deployed
   through current main; production-row reconciliation remains blocked by the
   database connector.
3. After Actions recovers, rerun and require all checks green on PRs 899 and 900.
4. Continue the shared Supabase server-client privilege-boundary audit after this
   chooser repair.
5. Authorized state-changing fixtures remain required for Golden Trident delivery,
   signing replay, and reconciliation workers.


### Schema-drift evidence classification factory

Evidence:

- PR 892 restored the mandatory `drift-report` artifact. Workflow run
  `32971820404`, artifact `9608406682`, digest
  `sha256:e6fae6e97def5ec644dc92dac623febef9383b00b147f08a1e579ec55e27e893`.
- The production metadata report contains 1,730 raw expectations but only 1,613
  unique object identities: 117 repeated expectations across 113 identities.
- Of 697 unique missing columns, 512 belong to one of 387 tables that the same
  report already marks missing. They are dependent symptoms, not 512 separate
  table-repair decisions. The baseline leaves 1,101 independently actionable
  identities before index-parent classification.
- No drift item has been classified as safe to recreate or applied to production.
  Current Supabase guidance documents `db diff` blind spots, so raw findings are
  evidence for review rather than automatic migration instructions.

Repair branch: `fix/schema-drift-classification`.

Repair:

- Add deterministic identity grouping, duplicate provenance, dependency
  classification, per-kind/per-class counts, and full + summary artifacts.
- Capture an index's owning table so indexes can join the same dependency graph.
- Bind every finding's source statement to the statement that produced the
  expectation instead of the first later statement that merely mentions it.
- Add regression coverage for duplicate collapse, table dependencies, independent
  objects, deterministic ordering, and schema-qualified index ownership.
- Keep Phase 1 report-only and make no schema, permission, credential, or
  production-data change.

Production checkpoint:

- PR 894 and the newer current-main Vercel deployment both reached successful,  status on 2026-08-26.,- The public Buddy landing journey rendered successfully with the expected title,  and content; no Buddy application console error was observed.,- Production responses proved the consolidated catch-all is live:,  `/crm/search` returned the preserved unauthenticated 401, `/crm/activities`,  returned 405 with `Allow: POST`, and an unknown route returned 404. All three,  reported `x-matched-path: /api/admin/brokerage/crm/[...path]`.
- Authorized transactional Golden Trident, SignWell, cron, and delivery fixtures
  remain required for state-changing closure.
- Direct production-row verification remains blocked by the Buddy Supabase
  connector's internal `-32603` connection error.

Next targets:

1. Run the classifier against production metadata in CI and classify the reduced
   independent set by historical drop/rename versus true current ownership.
2. Rotate to the next independent application/privacy/provider audit while PR 897 awaits review.
3. Continue non-conflicting privacy, provider, and critical-path regression rotation.

### Production baseline and merged repair verification

- PR 878 merged to `main` at `df740f97ebe007a553b2fcfa6811e9a7c6fa0df6`.
- Vercel production deployment reached `READY`; the authenticated Golden Trident
  admin surface reported commit `df740f9` and all three AI providers ready.
- No new fatal/error runtime events appeared during the two-hour post-deploy
  observation window.
- The complete authenticated seal -> marketplace -> lender-delivery mutation is
  not yet closed: executing it transmits live borrower data to external AI
  providers. It requires an explicitly authorized live QA transaction.
- Production database row verification is also open because the Buddy Supabase
  connector returned an internal connection error. No database health claim was
  inferred from source alone.

### Open merge checkpoint: PR 879

- Head: `8d4dcb3e5d42e4c27ec7aaf92392f9212ab9c830`.
- State: mergeable; CI, Build Check, Secret Scan, route budget, and Vercel preview
  all green.
- Repairs: preview redaction provenance persistence, revoked borrower-link
  enforcement, required feasibility narrative keying, and activation of fourteen
  previously skipped server-only regression tests.
- Production verification remains dependent on Matt merging PR 879.

### Identity reconciliation incident and repair

Evidence:

- Vercel recorded three Didit follow-up 404s on 2026-08-25 for
  `GET /v3/session/{sessionId}/`.
- Didit's current v3 contract exposes canonical retrieval at
  `GET /v3/session/{sessionId}/decision/`.
- Buddy's webhook and fallback reconciliation both called the unsupported endpoint,
  so a completed borrower could remain stranded behind the identity/sealing gate.
- Successful reconciliation also performed a redundant second decision request.

Repair branch: `fix/didit-decision-reconciliation`.

Repair:

- The compatibility status-fetch boundary now delegates to the supported decision
  resource.
- Webhook and fallback reconciliation consume one canonical vendor response and no
  longer issue a duplicate GET after approval.
- The service contract accepts the decision response shape instead of requiring
  creation-only `workflow_id` and `url` fields.
- Added an endpoint contract guard and an orchestration regression proving exactly
  one vendor read and a persisted approved/completed result.
- No schema change, dependency change, or production mutation.

Verification status: awaiting PR CI and preview deployment.

### Highest-value next independent targets

1. Diagnose the observed Golden Trident seal-status 30-second timeout using route,
   database-query, and runtime evidence.
2. Diagnose the independent `/api/buddy/signals/latest` timeout.
3. Re-establish Buddy Supabase connector access, then verify identity rows, sealed
   packages, full Trident bundles, and artifact provenance directly.
4. After PR 879 merges, verify revoked-link denial and redaction provenance in
   deployed production.
5. With explicit authorization for a live QA mutation, execute and evidence the
   production seal -> marketplace -> lender-delivery chain.


### Privileged Supabase identity and route-authorization boundary — PR 901

Production checkpoint:

- PR 900 merged as `5c0b0211cfadb12306bf5c6163ee07301804b307` and the
  exact Vercel production deployment reached READY on 2026-08-26.
- The public Buddy surface rendered correctly and the exact deployment had no
  error/fatal runtime logs during the post-deploy observation.
- A historical Golden Trident workflow FatalError on an older deployment was an
  intentional institutional-review publication block, not a PR 900 regression.

Evidence and root causes:

- `getSupabaseServerClient()` is a service-role client without a user session,
  yet multiple user routes called `auth.getUser()` on it. Legitimate Clerk users
  therefore received deterministic 401 responses.
- Several deal replay, examiner, memo, Ask Buddy, readiness, and spreads surfaces
  used the service role without first proving Clerk identity and deal-to-bank
  membership. Two borrower mutation routes also accepted an unbound
  token/deal-id pair.
- The Clerk-to-Supabase token exchange used `app_users.id` as `sub`, while
  current membership and tenant RLS use `profiles.id`.
- `increment_continue_usage(uuid)` was SECURITY DEFINER without a hardened
  search path or explicit EXECUTE revocation; its application fallback was
  non-atomic and used an unsupported client API.

Repair:

- Added canonical Clerk user and deal API contexts. Privileged database access
  now begins only after Clerk authentication, profile resolution, selected-bank
  resolution, and an explicit deal-to-bank comparison.
- Bound all identified deal AI, replay, condition, policy, memo, readiness, and
  spreads surfaces to that context. Bound borrower submit/upload-event mutations
  to a valid portal token whose resolved deal matches the request.
- Aligned Supabase JWT `sub` with `profiles.id`, preserved `app_users.id` as
  a separate claim, separated browser auth from server-only clients, and removed
  anonymous fallbacks from privileged clients.
- Made usage increments atomic-only and added a migration that fixes
  SECURITY DEFINER search-path and service-role-only EXECUTE privileges.
- Added a static regression guard spanning all repaired clients, contexts, routes,
  borrower bindings, JWT identity, and function grants.

Verification:

- Exact branch-head source was re-read after all GitHub writes; every enumerated
  privileged deal surface imports `resolveDealApiContext`, every borrower
  mutation resolves and binds its token, and none imports the ambiguous legacy
  server client.
- PR diff is limited to this identity/authorization arc, its migration, regression
  guard, and this ledger.
- Full required Actions, build, and exact-head Vercel verification remain open;
  no merge recommendation is recorded until they complete green.

Unresolved:

- The migration is not considered applied until post-merge database evidence is
  available.
- Direct production-row verification remains blocked by the Buddy Supabase
  connector's internal `-32603` connection error.
- Authorized transactional fixtures remain required for Golden Trident delivery,
  SignWell replay, and reconciliation workers.


### PR 901 post-merge release closure and CI repair

- PR 901 merged externally as `2622f3eb4420c09feefe7c3c64e3c14761d87213`;
  the commissioning agent did not merge it.
- PR 902 followed from PR 901 as its direct parent and deployed to production at
  `806535e543ac24cd854947786cc5ccb28c8e9726`.
- Production rendered with the matching boot SHA and the exact deployment
  reported no error/fatal logs in the post-deploy window.
- Recovered main-branch Actions caught one release-closure omission: the new
  `increment_continue_usage` function lacked a schema-manifest provenance entry,
  so the architecture gate failed before unit/E2E execution. The follow-up branch
  `fix/usage-function-schema-manifest` registers the object against migration
  `20260826163000_usage_function_privilege_boundary.sql`.
- A parallel Firebase App Hosting backend
  (`buddy-the-underwriter/us-east4/buddytheunderwriter-main`) is attached to main
  and failed its rollout while canonical Vercel production remained READY. No
  repository App Hosting configuration was found. Whether to retain and commission
  or disable this non-canonical deployment is a product/infrastructure decision.
- Legacy identity namespaces remain an evidence-classification target:
  `platform_admins.user_id` references `app_users.id`, while
  `user_usage.user_id` retains an older `auth.users(id)` foreign key. No
  destructive FK or production-row rewrite is authorized without restored
  Supabase connector evidence.
