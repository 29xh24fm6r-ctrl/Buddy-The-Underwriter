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


### PR 904 recovered CI evidence

- GitHub Actions recovered and created required workflows for PR 904 head
  `77ff0b3d8c993588a49fa4071e5f1744b47bdf63`.
- Typecheck and lint passed, then the architectural guard correctly failed because
  merged PR 903 introduced `finalize_intake_and_enqueue_processing` without a
  schema-manifest provenance entry. Later CI steps were therefore skipped; PR 904
  was not treated as merge-ready.
- PR 904 now also registers that function against
  `20260827010000_atomic_intake_locking.sql`. This is a release-ledger correction
  only and does not modify database state.
- The PR 903 function is SECURITY DEFINER and was granted to `authenticated`
  despite accepting caller-controlled deal and bank identifiers. Its application
  route performs tenant authorization, but direct RPC calls bypass that route.
  The independent stacked PR 905 revokes direct anon/authenticated execution,
  grants service-role-only execution, hardens search_path, and adds a regression
  contract while preserving the authorized server route.
- PR 905 exact-head Vercel preview `84a6dbd1d48a7536d12cae12e3dfa3dbc22f2ab8`
  is READY, returns HTTP 200 with the matching build SHA, and has no error/fatal
  runtime logs. Full Actions must run after PR 904 merges and PR 905 is retargeted
  to main.


### Atomic intake RPC privilege boundary

Evidence and root cause:

- PR 903 introduced `finalize_intake_and_enqueue_processing` as a
  `SECURITY DEFINER` function that locks and finalizes documents, writes the deal
  event and processing outbox, and transitions the deal.
- The application route correctly authenticates and calls
  `ensureDealBankAccess(dealId)` before using the service-role client.
- The migration nevertheless granted direct EXECUTE permission to
  `authenticated`. A client could therefore bypass the authorized route and
  supply arbitrary deal, bank, actor, snapshot, and run identifiers to the
  privileged function.

Repair branch: `security/finalize-intake-rpc-privilege-boundary`.

Repair:

- Add a forward migration that fixes the function search path, revokes EXECUTE
  from `PUBLIC`, `anon`, and `authenticated`, and grants only
  `service_role`.
- Preserve the authorized server route and its atomic transaction unchanged.
- Add regression coverage that binds the RPC to the tenant-authorized server
  route and enforces the service-role-only grant contract.
- No borrower data, document data, deal state, function body, dependency, or
  provider configuration is changed.

Verification target:

- Focused privilege-boundary test, migration guards, full required CI, and exact
  Vercel preview must pass before merge.
- Post-merge database verification remains dependent on restoration of the Buddy
  Supabase connector, currently returning `-32603`.


### PR 905 production closure and PR 906 workflow-identity boundary

Production evidence:

- PR 905 merged externally as `121e1f1e6519998545c0730f136c683920f46fc8`;
  the commissioning agent did not merge it.
- Vercel production deployment `dpl_6QHNka5i1puw2XYqcujAxeBPCvxG` is READY
  and reports that exact GitHub SHA.
- The public `www.buddysba.com` surface rendered successfully. No Buddy
  application console errors were observed; the only browser errors came from
  the browser automation extension.
- An unauthenticated POST to the deployed intake-confirmation route returned
  HTTP 401 with `{"ok":false,"error":"unauthorized"}` before deal processing.
- The exact production deployment recorded 166 HTTP 200 responses and no
  runtime error clusters in the one-hour post-deploy observation window.

Database verification boundary:

- Current Supabase documentation confirms that functions bypass RLS and must
  restrict EXECUTE to the intended roles, matching PR 905's migration contract.
- The generic Supabase connection available to commissioning exposes a different
  project, not an identified Buddy The Underwriter project. It was not queried.
  Direct production ACL verification remains blocked until the owned Buddy
  Supabase connection is restored or explicitly identified.

PR 906 review finding and repair:

- The new shared Trident starter originally wrapped both durable workflow start
  and `workflow_run_id` persistence in one catch block.
- If `start(goldenTridentWorkflow)` succeeded but the tracking write failed,
  that catch called `fail_trident_bundle_run`, releasing the bundle lease even
  though a workflow was already executing. A retry could then admit a duplicate
  generation against the same deal and mode.
- The starter now confines lease release to failures thrown by `start()`.
  Tracking-write failure after a successful start is surfaced to runtime logs
  while the live workflow retains ownership, and the caller receives the durable
  run identity.
- Regression coverage enforces that `fail_trident_bundle_run` cannot appear in
  the post-start persistence boundary.
- PR 906 head after this repair is `d7ec5047924ddd6b3c8019881f369b10c559dd00`.
  Required GitHub Actions workflows have not yet been created; no merge
  recommendation is recorded until they run green. Exact-head Vercel preview
  verification must also complete after the new push.

Remaining checkpoints:

- Run and pass all required PR 906 workflows, then inspect the complete final
  diff and exact-head preview before merge recommendation.
- After PR 906 merges, verify deployed preview redaction and durable generation
  behavior with an authorized QA fixture.
- Golden Trident delivery, SignWell replay, and reconciliation workers still
  require authorized transactional fixtures.


### PR 906 production closure and Trident startup-failure convergence

Production evidence:

- PR 906 merged externally as `d5a1df302a746ffa5d9545aa7a99267a2225f080`;
  the commissioning agent did not merge it.
- Vercel production deployment `dpl_Hbi9jUqPfoxgGNkYz9Tk2mxUJSka` is READY
  on that exact SHA. The public Buddy surface rendered cleanly, no Buddy
  application console errors were observed, and no runtime error clusters were
  present in the two-hour post-deploy observation.
- The unauthenticated intake-confirmation probe remains fail-closed with HTTP 401.

New evidence and repair branch `fix/trident-start-failure-convergence`:

- When durable workflow startup throws, the shared starter performs a second
  `buddy_trident_bundles` read to rediscover the input hash and ignores both
  read and `fail_trident_bundle_run` errors. A failed cleanup therefore leaves a
  90-minute live lease even though no workflow owns it, and subsequent requests
  appear reused until reconciliation.
- Admission now returns the exact input hash already computed and written with
  the lease. Startup cleanup uses that identity directly, removing the extra
  read and its failure mode.
- Cleanup response errors and thrown provider errors are both observed. A failed
  lease release is logged with the bundle identity and returned as a distinct
  retry-after-reconciliation condition rather than false-normal start failure.
- Regression coverage enforces the read-free cleanup boundary, exact admitted
  identity, release-error handling, and preservation of the post-start ownership
  rule from PR 906.

Verification target:

- Focused durable Golden Trident regression, full required CI, exact-head Vercel
  preview, and complete PR diff inspection must pass before merge recommendation.
- Transactional production closure still requires an authorized Golden Trident QA
  fixture. Direct database verification remains blocked until the owned Buddy
  Supabase project is explicitly available; the differently named project exposed
  by the generic connector was not queried.

### PR 907 production closure and PR 909 Golden Trident request-boundary / CI-honesty factory

Production evidence:

- PR 907 merged externally as `199df7ceb14db01af6cfd6bca97a470acbd51281`;
  the commissioning agent did not merge it.
- Vercel production deployment `dpl_9wLdAQSXDcQmH9PxRh1AZ2Br8t5S` is READY
  on that exact merge. `www.buddysba.com` returned HTTP 200 with the exact
  `x-buddy-build` SHA, and no error/fatal runtime cluster was observed in the
  post-deploy window.
- Source and merge-ref inspection confirms PR 909 retains PR 907's startup-failure
  lease convergence and post-admission workflow ownership boundaries.

PR 909 evidence and root causes:

- Three Golden Trident initiation surfaces still performed request-scoped inline
  generation. A platform timeout could terminate the request while the durable
  bundle lease remained active, producing a 90-minute apparent lockout and an
  unsafe retry experience.
- Seventeen tests below Next.js dynamic-route directories were discovered and
  counted but did not execute. The package script handed bracketed paths through
  unquoted shell command substitution, allowing the shell to expand or discard
  them before Node received its positional arguments.
- Input snapshot ordering used locale-sensitive comparison, feasibility
  acceptance admitted placeholder narratives, artifact downloads lacked audit
  events, preview redaction provenance was not wired to the response, and
  degraded previews did not explain their reason.

Repair:

- Route all three generation entry points through the durable workflow starter and
  return accepted run identity instead of generating inline.
- Replace shell command substitution with a `shell:false` argv runner that passes
  exact literal test paths. Add a guard that executes a real `[token]` route test
  and requires a non-zero test count.
- Make snapshot hashing locale-independent, reject placeholder feasibility text,
  record artifact-download audit events, surface persisted redaction provenance,
  and give degraded previews an explicit reason.
- Preserve existing URLs, authorization, workflow admission semantics, and PR 907
  lease ownership. No schema, migration, dependency, credential, permission,
  provider configuration, or production-data change is included.

Verification on PR 909 head `badded1be9b87043243e5cbcffe6c001a32e80b8`:

- GitHub reports the branch mergeable, clean, and zero commits behind `main`.
- CI: 13,214 tests; 13,205 passed, 0 failed, 9 skipped.
- The effect-based F-24 guard passed, proving tests below dynamic Next.js
  segment directories execute rather than merely being discovered.
- React-server condition: 18 passed, 0 failed.
- Research evaluation: 7 passed, 0 failed, 13 placeholder cases skipped.
- Typecheck, lint, architecture, safety, legacy-write, polling, Never-500, schema
  select, and report-only schema-drift gates passed.
- Build Check, Secret Scan, Route Budget, and public Playwright passed.
  Public Playwright ran 6 tests: 1 passed and 5 intentionally skipped.
  Authenticated smoke was unavailable and explicitly skipped.
- Exact-head Vercel preview `dpl_8s7KrEzvtaptcZEy1Bh6Q4WAzSuY` is READY,
  returned HTTP 200 with `x-buddy-build` matching the GitHub head, and had no
  error/fatal runtime logs in the post-deploy observation window.
- PR 909 is safe for Matt to merge. The commissioning agent did not merge it.

Open checkpoints:

- After merge and deployment, execute one authorized Golden Trident generation
  and failure/retry fixture to close the transactional lease and delivery path.
- Direct production-row verification remains blocked until a verified
  Buddy-owned Supabase project connection is available; the currently exposed
  differently named project remains unqueried.
- Replace the 13 research golden-set placeholders with production-backed cases.

### PR 909 production closure and PR 910 SignWell canonical-completion integrity factory

Production and lineage evidence:

- PR 909 merged externally as `034453f92ea4ad71ab943014a0765a47f95af100`;
  the commissioning agent did not merge it.
- Vercel production deployment `dpl_2cr6fZWmaecoPv9z9ucYoinY7rpp` is READY
  on that exact commit. `www.buddysba.com` returned HTTP 200 with
  `x-buddy-build: 034453f92ea4ad71ab943014a0765a47f95af100`.
- No Vercel runtime-error cluster was present in the two-hour production
  observation window.
- PR 878's seal-to-marketplace-to-lender contract remains in production source
  lineage through subsequent merges. Transactional closure still requires an
  authorized fixture; no production deal or provider transaction was created
  during this cycle.

PR 910 evidence and root cause:

- SignWell's documented event digest authenticates `event.type` and
  `event.time`, not `data.object`. Buddy refetched the provider document but
  did not require its canonical ID, terminal completion status, Buddy
  `external_id`, and recipient email to match the durable signing request
  before downloading and persisting signed bytes.
- Completion-time IAL2 evaluation ran before durable signing-request provenance
  was established, so unbound object fields could reach a deal-scoped anomaly
  write.
- The test-mode provider path returned an old permissive document shape and
  therefore did not exercise the production canonical-completion invariant.

Repair:

- Preserve SignWell metadata when parsing the canonical provider response.
- Treat webhook object data only as a lookup hint; fail closed unless provider
  ID, terminal status, external ID, and a non-empty recipient email match the
  durable signing request before PDF download, storage, or compliance-row
  persistence.
- Establish durable signing-request provenance before deal-scoped IAL2 anomaly
  handling.
- Make the test-mode completion route reconstruct canonical provider identity
  from its durable request and add integration and negative regression coverage
  for document-ID, status, metadata, missing-email, unknown-document, and
  recipient mismatches.
- No schema, migration, credential, provider configuration, or production-data
  mutation is included.

Verification:

- The first full run exposed two stale happy-path fixtures; both were repaired,
  and the complete suite was rerun.
- On pre-reconciliation head `09d21511121d26ebaa5eda2b11391890d1fd5df6`:
  13,193 tests ran; 13,184 passed, 0 failed, 9 skipped. React-server tests were
  18/18. Research evaluation was 7 passed, 0 failed, with 13 known placeholder
  cases skipped. Public Playwright passed (1 passed, 5 intentionally skipped);
  authenticated smoke was unavailable and explicitly skipped.
- Typecheck, lint, architecture, safety, legacy-write, polling, Never-500,
  schema-select, report-only schema drift, Build Check, Secret Scan, and Route
  Budget passed.
- Exact-head preview `dpl_4cSZXDnQPvPxmrnsk47NumFCx8wh` was READY, returned
  HTTP 200 with the matching head SHA, and had no error/fatal runtime logs.
- After PR 909 merged, current `main` was reconciled into PR 910 with no
  overlapping files. The final exact-head CI/preview rerun is required before
  the PR can be marked merge-ready.

Open checkpoints:

- Do not merge PR 910 until its post-reconciliation exact-head checks are green.
- After PR 910 merges, execute one authorized SignWell completion/replay fixture
  and verify the signed-document row, storage artifact, audit event, and durable
  request transition.
- Direct production-row verification remains blocked until the verified
  Buddy-owned Supabase project connection is available; the differently named
  project exposed by the generic connector remains unqueried.
- Golden Trident generation/failure-retry/delivery closure still requires an
  authorized transactional fixture.
- Replace the 13 research golden-set placeholders with production-backed cases.



### PR 910 production closure and SignWell request-compensation factory

Production closure:

- PR 910 merged externally as `743899a2e83fe57e7412f5cd4dfb705b751302d5`;
  the commissioning agent did not merge it.
- Vercel production deployment `dpl_6dMXz7uB1HpgbpTaEgghnEgN2bcy` is READY
  on that exact SHA. `www.buddysba.com` returned HTTP 200 with the same
  `x-buddy-build` value.
- No PR 910 runtime-error cluster was observed. The two aggregated Golden
  Trident workflow failures in the seven-day view are deliberate publication
  blocks after institutional review and belong to older deployments.
- Transactional SignWell completion/replay closure still requires an authorized
  fixture; no provider transaction or production row was mutated in this cycle.

New evidence and root cause:

- `requestSignature` creates and sends a non-draft SignWell document before
  inserting Buddy's durable `signing_requests` provenance row.
- A missing provider signing URL, a returned insert error, or a thrown database
  error returned `SUBMISSION_FAILED` without cancelling the already-created
  provider document. The recipient could retain a live signing invitation that
  Buddy could not reconcile, while a retry could create a second request.
- SignWell's current API contract documents
  `DELETE /api/v1/documents/{id}`; deletion also cancels signing in progress
  and returns HTTP 204 on success.

Repair branch: `fix/signwell-untracked-document-compensation`.

Repair:

- Add a typed SignWell deletion client that accepts the documented 204 empty
  response.
- Compensate every post-creation/pre-tracking failure by deleting the provider
  document before returning failure.
- If provider cleanup itself fails, preserve the original failure, return an
  explicit `provider_cleanup_failed` condition, and log the provider document
  identity for operational reconciliation.
- Wire the real and mock client shapes through every Buddy signing route and add
  regression coverage for missing URLs, database errors and throws, cleanup
  failure observability, provider endpoint shape, and mock parity.
- No schema, migration, credential, provider configuration, or production-data
  change is included.

Verification target:

- Focused SignWell unit/integration tests, full CI and build guards, complete
  diff inspection, and exact-head Vercel preview must pass before merge
  recommendation.
- Direct production-row verification remains blocked until the verified
  Buddy-owned Supabase connection is restored; the differently named project
  exposed by the generic connector remains unqueried.
