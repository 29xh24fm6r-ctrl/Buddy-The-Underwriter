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

Verification on code head `427233b794275ee04aee6df66c590647c5e1c200`:

- CI ran 13,224 tests: 13,215 passed, 0 failed, 9 skipped.
- React-server-condition tests passed 18/18. Research evaluation passed 7/7;
  the 13 known production-data placeholders remain explicitly skipped.
- Typecheck, lint, architecture, legacy-write, safety, polling, Never-500,
  schema-select, report-only schema-drift, Build Check, Secret Scan, Route
  Budget, and public Playwright passed. Authenticated smoke was unavailable
  and explicitly skipped.
- Exact code-head Vercel preview `dpl_GaEogpbrZGksVcrixASH46iK9xJz` is
  READY, returned HTTP 200 with matching `x-buddy-build`, and recorded no
  error/fatal runtime logs in the post-deploy window.
- The complete diff is one commit ahead of current `main`, zero commits
  behind, and limited to this repair, regression coverage, route wiring, and
  the ledger. A final ledger-only close commit must retain green required
  checks before merge recommendation.

Open checkpoints:

- After merge, verify deployed production behavior and execute one authorized
  failure-compensation fixture plus completion/replay fixture.
- Direct production-row verification remains blocked until the verified
  Buddy-owned Supabase connection is restored; the differently named project
  exposed by the generic connector remains unqueried.

### PR 917 AI gateway durable-governance factory

Production and dependency checkpoint:

- Production remains on Buddy The Underwriter commit
  `3c59678b18c6e4127520c76acb606097899c44b2`, which contains the externally
  merged PRs 911-914. The commissioning agent did not merge them.
- PR 915 (terminal SignWell convergence) and PR 916 (Golden Trident
  commissioning-support convergence) remain open, mergeable, and independent
  of this arc.
- PR 878's seal-to-marketplace-to-lender code lineage remains deployed.
  Transactional delivery closure still requires an authorized Golden Trident
  fixture; no production deal, provider call, or row was created in this arc.

Evidence and root causes:

- `logGatewayCall` swallowed Supabase insert and client failures. A provider
  result could therefore drive underwriting state without durable SR 11-7
  audit evidence; a failed attempt could also advance to a second provider
  while neither attempt was durably recorded.
- Daily token budgets were process-local maps, so parallel or recycled Vercel
  instances could each admit the full daily allowance.
- Streaming calls recorded zero input and output tokens, and embedding calls
  used the same process-local authority.
- A first repair draft released expired reservations at zero. Review proved
  that a process crash after provider admission would reopen potentially spent
  capacity, so abandoned reservations must be conservatively charged.
- Character-based estimation could undercount multilingual text. UTF-8 bytes
  provide a conservative tokenizer-independent upper bound.

Repair in PR 917:

- Make ledger persistence observable and fail closed before an unledgered AI
  result or fallback attempt can affect product state.
- Add service-role-only, `SECURITY DEFINER`, empty-search-path reservation and
  settlement RPCs plus private daily-budget and reservation tables.
- Serialize admission per UTC day and role with transaction advisory locks,
  account for active reservations, settle idempotently, and charge expired
  unconfirmed reservations at their reserved upper bound.
- Cover generator roles and the gateway-adjacent embedder with the same durable
  authority. Reserve text by UTF-8 byte upper bound and meter streaming output
  conservatively instead of recording zero.
- Revoke table and RPC access from PUBLIC, `anon`, and `authenticated`;
  grant only `service_role`. The budget tables store counters and role/day
  metadata only—no prompt, document, model output, or borrower data.
- Preserve provider chains, model selection, NPI gates, prompts, underwriting
  calculations, artifact persistence, sealing, publishing, and delivery
  behavior.
- Add behavioral tests for fail-closed success/failure paths, embeddings,
  multilingual estimates, typed budget exhaustion/persistence errors, atomic
  RPC shape, crash-safe expiry, and schema/privilege tripwires.

Validation history:

- Initial exact-head TypeScript correctly exposed the embedding ledger's stale
  `Promise<void>` contract; the embedding path was brought under the same
  fail-closed contract rather than weakened with a type-only patch.
- A subsequent broad run passed TypeScript, lint, architecture and safety
  guards, then exposed legacy unit callers that replace providers without a
  database ledger seam plus one formatting-sensitive structural assertion.
  Production detection now requires exact real provider and ledger bindings;
  explicit false-ledger tests still exercise fail-closed behavior.
- Final exact-head Build Check, CI, preview, and runtime-clean verification are
  required before this draft can be marked merge-ready.

Open checkpoints:

- Do not merge PR 917 until its final exact-head required checks and Vercel
  preview are green.
- The migration has not been applied or queried directly. After merge, verify
  tables, function definitions, browser-role denials, service-role execution,
  concurrent admission, settlement, and expiry only through the explicitly
  verified Buddy-owned Supabase connection.
- Direct production-row verification remains blocked because the available
  differently named project has unconfirmed ownership and remains unqueried.
- Authenticated browser checks, authorized identity/signing/Golden Trident
  fixtures, and the 13 production-backed research cases remain outstanding.

## 2026-08-27 — bounded nightly work and empty-portfolio convergence

Resume checkpoint:

- PRs 915, 916, and 917 have merged into current `main`; their SignWell,
  Golden Trident, and durable AI-governance work is preserved in this resolved
  branch.
- PR 918 is synchronized through a non-destructive merge of current `main`
  with only its bounded-nightly-work repair.
- Direct Buddy database verification remains blocked because the available
  connector exposes a differently named project whose ownership is not
  verified. It was not queried.

Production evidence:

- On deployment `dpl_2TxXjafT9K4Y1PMo5ojy7hmQCZ7j` at
  2026-08-27T07:30:38Z, `/api/cron/nightly` logged
  `No final decisions found for portfolio aggregation` for five banks.
- The same run logged a PostgreSQL statement timeout from
  `purge_buddy_system_events`.
- The failures are independent of PRs 915-917 and are addressed on branch
  `codex/nightly-bounded-work`.

Root causes:

- Portfolio aggregation discarded Supabase read and write errors, while
  throwing for the normal state where a bank has no final decisions. The
  nightly route therefore emitted production errors and skipped later
  no-op-safe governance steps for empty banks.
- Each retention RPC looped through the entire backlog in one transaction.
  A statement timeout rolled back every batch, so a sufficiently large
  backlog could make no durable progress.
- The TypeScript orchestrator called each purge once and stopped at the first
  failure, allowing one retention path to starve the others.

Repair:

- Empty portfolios now return an explicit null result, while decision reads
  and snapshot writes fail loudly and distinctly.
- The nightly route records `skipped_no_final_decisions` and continues policy
  drift and living-policy work.
- Additive migration
  `20260827080000_bounded_nightly_retention.sql` replaces all three purge
  functions with one 5,000-row transaction per RPC, an empty search path,
  fully qualified relations, and service-role-only execution.
- The application drains up to ten batches per table per nightly run, validates
  provider counts, attempts every table even when one fails, and reports an
  aggregate failure afterward.
- Regression coverage exercises empty portfolios, database failures, snapshot
  writes, draining, caps, cross-table isolation, count validation, and SQL
  architecture invariants. The schema manifest records the replacement
  function provenance.

Verification:

- The first CI run correctly rejected replacement-only manifest provenance;
  the ledger now preserves both the original and replacement migration entries.
- On code head `966f801aebbb298310671b411d2a11229eb17245`, 13,246 tests
  ran: 13,237 passed, 0 failed, and 9 skipped. React-server tests passed 18/18.
  Research evaluation passed 7/7 with the 13 known production-data placeholders
  explicitly skipped; public Playwright passed with authenticated smoke
  explicitly skipped.
- Typecheck, lint, architectural guards, legacy-write, safety, polling,
  Never-500, schema-select, report-only schema drift, CI, Build Check, Secret
  Scan, and Route Budget passed.
- Exact code-head preview `dpl_9hwSDkqnquCcR2HidfWXE3FnV9Tg` was READY,
  returned HTTP 200 with matching `x-buddy-build`, and had no warning, error,
  or fatal runtime logs in the verification window.
- The final ledger-only head must retain the same green required checks before
  the PR is marked merge-ready.
- No migration, provider transaction, production row, or production data was
  changed during this cycle.

Post-merge closure:

- Apply the migration through the normal deployment path, then confirm the next
  nightly run reports empty portfolios as skips rather than errors.
- Using the verified Buddy-owned Supabase connection, verify each purge commits
  bounded progress and that subsequent runs drain the backlog without statement
  timeouts.
- The separate transactional blockers remain: authorized SignWell,
  identity/authenticated-browser, and Golden Trident fixtures, plus replacement
  of 13 research placeholder cases with production-backed regressions.

### PR 919 — borrower portal token-state convergence and storage privacy

Evidence and root cause:

- The authoritative `peek_borrower_portal_link` RPC rejects expired,
  revoked, and consumed single-use links, but thirteen public portal data and
  mutation routes bypassed it with service-role table reads.
- The document-listing route selected `expires_at` but never enforced it, so
  an expired bearer link could enumerate borrower filenames, document status,
  and private storage bucket/object coordinates.
- Revoked or consumed links remained usable across context, checklist,
  condition, guided-evidence, document-confirmation, loan-request, request
  status, and condition-upload paths.
- Borrower-facing Golden Trident preview generation and signed artifact
  downloads used a separate direct-table gate which did not enforce consumed
  state.
- The context route manually marked a single-use link consumed before the
  portal's later API calls, leaving authorization behavior split across routes.
- A legacy orchestration guard encoded the vulnerable direct-table lookup as
  its definition of token validation.

Repair:

- Converge public portal data and mutation routes on
  `resolveBorrowerToken`, which validates invites and routes portal links
  through the authoritative state-machine RPC.
- Converge session-aware upload context resolution on the same helper.
- Route Trident portal authorization through `peekBorrowerPortalLink`.
- Remove storage bucket/object coordinates from the public document response.
- Replace the stale direct-table guard and add a recursive tripwire preventing
  future public portal routes from querying `borrower_portal_links`
  directly.
- Add Trident tests for expired, revoked, consumed, missing, and indeterminate
  link state. No migration, credential, provider configuration, or production
  data change is included.

Verification in progress:

- Initial TypeScript, lint, architecture, safety, Secret Scan, and Route Budget
  checks passed.
- Exact code-head preview `dpl_AJzxw3yqt1boyMknvcrcRSAkz5rk` was READY,
  returned HTTP 200 with matching `x-buddy-build`
  `5b09ef0d24a8891f0da8aa518b6bae0efaab090f`, and had no error/fatal
  runtime logs.
- An unauthenticated request to
  `/api/portal/commissioning-invalid-token/docs` returned the expected
  HTTP 404 JSON response.
- The first broad unit run found the stale phase-65F direct-table guard. The
  guard has been corrected and the exact-head suite must be green before this
  PR is merge-ready.

Open checkpoints:

- Monitor PR 919's exact-head required checks and preview after the guard/ledger
  push; do not merge from commissioning.
- After merge, reverify the deployed SHA and execute an authorized
  expired/revoked/consumed-token fixture across document listing, condition
  upload, and Trident preview/download.
- Direct row verification remains blocked until the verified Buddy-owned
  Supabase connection is available. Authenticated browser credentials and
  authorized transactional identity/signing/Golden Trident fixtures also
  remain outstanding.
- The next independent audit target is storage-object lifecycle and orphan
  reconciliation after the token boundary is deployed.

### Storage lifecycle convergence factory

Production and source evidence on 2026-08-27:

- A signed-out request to
  `/api/deals/eefd62b3-4ae2-4d43-bb80-9953fdca9bcc/uploads`
  returned HTTP 200 from deployed production with
  `x-clerk-auth-status: signed-out`. The current invocation returned an empty
  array, but the route would expose deal-scoped temporary filenames, sizes, and
  timestamps whenever its warm function instance held files.
- The legacy `POST /api/storage/upload` route authorized the deal before
  writing, but both its GCS and Supabase branches returned success after storing
  bytes without creating `borrower_uploads` or `deal_documents` provenance.
  A caller interruption or a missing follow-up therefore left an unowned object.
- No `/api/storage/upload` invocation was found in the available 24-hour
  production runtime-log window. That is evidence of no observed recent use,
  not proof that the compatibility route has no callers.
- The separate orphan detector remains a dark supporting path: it depends on a
  caller-supplied `exec_sql` RPC and its database-only query is not scoped to
  the scanned bucket/prefix. It is recorded as a later repair target and was not
  activated or run against production.

Repair branch: `codex/storage-lifecycle-convergence`.

Repair:

- Require tenant-authorized deal access before any filesystem metadata read in
  the legacy inventory route.
- Make every production legacy upload persist canonical upload provenance and
  run the existing idempotent materializer before returning HTTP 200.
- Make upload commit failures phase-aware. If the durable audit row exists,
  preserve the object and return HTTP 202 so background reconciliation can
  recover without asking the user to upload again.
- If provenance fails before any durable row exists, remove only the object
  created by that same request using the provider API. Surface failed
  compensation as an explicit reconciliation condition.
- Add behavior tests for successful commit, durable retry, safe compensation,
  failed compensation, unknown-error byte preservation, and source guards for
  authorization and both storage providers.
- No pre-existing object, production row, schema, RLS policy, provider
  configuration, credential, or dependency is changed.

Verification on code head `26f0f7d9f0f88d09d8817b9c3f493fb5e4344a8a`:

- CI ran 13,246 tests: 13,237 passed, 0 failed, and 9 skipped.
  React-server-condition tests passed 18/18. Research evaluation passed 7/7;
  the 13 known production-data placeholders remain explicitly skipped.
- Typecheck, lint, architecture, safety, legacy-write, polling, Never-500,
  schema-select, report-only schema drift, Build Check, Secret Scan, Upload
  Architecture Guard, Route Budget, and public Playwright passed. Public
  Playwright ran 1 test and skipped 5 authenticated tests because credentials
  were unavailable.
- Exact-head Vercel preview `dpl_DGY1EZsDfK15otJHZaEEbZssqLqs` is READY,
  returned HTTP 200 with `x-buddy-build` matching the code head, and recorded
  no error/fatal runtime logs in the post-deploy observation window.
- The same signed-out inventory probe that returned HTTP 200 in production
  returned HTTP 401 from the exact-head preview with
  `{"ok":false,"error":"authentication_required"}`.
- PR 919 remains independently open, mergeable, and zero commits behind
  `main`; this repair does not modify its portal-token surfaces.
- Direct orphan-row verification remains blocked until the verified Buddy-owned
  Supabase connection is available. No unverified database project was queried.
- This evidence-only ledger commit does not change runtime code. Its resulting
  exact head must retain green required checks and a READY, SHA-matched preview
  before merge recommendation.


## 2026-08-27 — document worker convergence (post-PR 935)

- Production evidence: PR 935 merged as `369044c8ffef4ce8b714e1f277f62599511f583e`; its Vercel production deployment reached READY and owns `www.buddysba.com`.
- Confirmed root causes from the prior production worker tick:
  - `EXTRACTION_HEARTBEAT` used the canonical financial-fact writer without a period, so the period-integrity guard rejected it and the spreads extractor failed with `deal_financial_facts_upsert_failed:invalid_period_date`.
  - the spreads worker scheduled unified readiness through the browser/session tenant guard, producing `not_authenticated` / `tenant_mismatch` despite already holding a deal- and bank-bound leased job.
  - TypeScript admitted Aegis `event_type=info`, but the live `buddy_system_events_event_type_check` enum does not; informational rows were rejected.
- Repair branch: `commissioning/document-worker-convergence`.
- Repair:
  - explicitly permits the sentinel period only for the non-financial extraction-heartbeat metadata row;
  - verifies the worker's deal/bank pair through the service client, issues the existing opaque branded grant, and forwards it through unified readiness and memo-input assembly; browser callers still execute the normal Clerk tenant check;
  - normalizes the TypeScript-only Aegis `info` alias to persisted `success`, and fixes the one direct alert-ledger insert;
  - adds a static regression guard for all three contracts.
- Production verification: pending merge and a subsequent document-worker invocation. An authenticated controlled upload/OCR fixture and the complete PR 878 Golden Trident delivery ceremony remain separately blocked on authorized fixtures.
- Database evidence remains blocked: the available Supabase connection identifies as Pulse OS rather than Buddy and was not queried or modified.


### Golden Trident artifact persistence truthfulness — PR 969

Checkpoint:

- PRs 967 and 968 remain clean, mergeable, and exactly current with `main`;
  their marketplace/download callers were not modified.
- Production remains on `fe428208311739a0147294d10c1e2d3d4d1ceb2b`, serves
  `www.buddysba.com` with HTTP 200, and has no grouped runtime errors in the
  latest two-hour observation window.
- PR 878's Golden Trident code remains deployed. Complete seal-to-marketplace-
  to-lender transactional closure still requires a verified Buddy-owned
  Supabase connection and an authorized sealed transaction.

Evidence and root cause:

- Supabase updates do not return affected rows unless `.select()` is chained.
  Golden Trident's artifact stages treated an error-free update as proof even
  when a lease/filter matched zero rows.
- Business-plan, projection, and feasibility objects are uploaded before their
  database manifest references are written. A lost lease, database outage, or
  returned-value mismatch could therefore leave borrower artifacts untracked
  in storage while the factory advanced.
- Reviewed business-plan source paths and canonical SBA/memo/spread/feasibility
  bindings had the same error-only proof gap.
- Final projection source reads also discarded database errors, collapsing
  authoritative-state outages into a later generic missing-artifact failure.

Repair branch: `codex/commission-trident-artifact-persistence`.

Repair:

- Add one returned-row proof boundary for artifact and source-binding writes.
  It distinguishes database errors, zero-row lease loss, and returned-value
  mismatch.
- Compensate failed manifest writes by removing only storage objects uploaded by
  the current attempt, grouped and deduplicated by bucket. Previously persisted
  and resumable artifacts are never removed.
- Require the Storage upload response to return the exact requested object path.
- Apply the boundary to reviewed business-plan sources, bundle business plans,
  projection PDF/XLSX files, feasibility files, SBA/feasibility checkpoints,
  and canonical memo/spread bindings.
- Surface final projection source-read outages directly.
- Add direct regression coverage for success, database failure, zero-row
  updates, mismatched returned rows, grouped cleanup, deduplication, and
  cleanup-failure evidence.
- No schema, migration, dependency, credential, provider, or production-data
  change.

Verification:

- PR 969 head `5b332c597e08b7def6cefb4d560faa1f5dbafb2b` passed CI,
  Build Check, Secret Scan, typecheck, lint, architecture and safety guards,
  schema-select, Never-500, research evaluation, and public Playwright.
- The full unit suite passed 13,482 tests: 13,473 passed, zero failed, and nine
  skipped. React-server passed 18/18; research passed 7/7 with 13 authorized
  fixture placeholders skipped.
- Exact-head Vercel deployment `dpl_F3S9psmRbaHodc4d7AkZaSWsK7qC` is READY,
  returns HTTP 200 with matching `x-buddy-build`, and has no warning, error,
  or fatal runtime logs.
- The complete five-file diff was inspected; PR 969 is mergeable and zero
  commits behind `main`.
- Post-merge transactional closure requires an authorized Golden Trident
  generation fixture and the verified Buddy-owned Supabase connection.
- The next independent audit target is sealed-artifact retention and
  supersession reconciliation. The QA-identity outage classification repair
  remains deferred while PRs 967-968 own overlapping delivery callers.

## 2026-08-29 — atomic seal and marketplace-listing lifecycle

Checkpoint:

- PR 970 remains open, clean, mergeable, and current with `main`; this repair
  does not modify its Golden Trident supersession migration or regression guard.
- Production deployment `dpl_EQob5PMxWaA85DupqtdKcuaYEi49` is READY on exact
  commit `fe428208311739a0147294d10c1e2d3d4d1ceb2b`, serves
  `www.buddysba.com` with HTTP 200, and has no runtime-error cluster in the
  latest two-hour observation window.
- PR 878's Golden Trident code remains deployed. Complete seal-to-marketplace-
  to-lender transactional proof remains blocked on the verified Buddy-owned
  Supabase connection and an authorized sealed transaction.

Evidence and root cause:

- Seal creation independently inserted the sealed package, inserted the listing,
  and updated the deal. Listing failure used best-effort compensation without
  checking its error or affected row; the deal-status update was also unchecked.
- Borrower unseal discarded the authoritative listing-read error and ignored the
  package update, listing delete, and deal update results before returning
  success.
- Rate-card database errors were indistinguishable from a genuine missing card.

Repair branch: `codex/commission-atomic-seal-lifecycle`.

Repair:

- Move seal creation and unseal into two service-role-only transactional RPCs.
- Lock and prove the tenant deal, exact current certified Golden Trident bundle,
  all three frozen artifact paths, eligible listing, active package, and every
  deal-state transition.
- Require returned package/listing ids before the route reports success.
- Remove the route's partial-write compensation window.
- Fail rate-card database unavailability closed with HTTP 503 while preserving a
  genuine missing-card business/configuration response.
- Preserve empty-search-path privileged functions and revoke execution from
  `PUBLIC`, `anon`, and `authenticated`.

Verification:

- Focused atomic-lifecycle regression coverage passed 7/7 locally.
- Initial CI passed typecheck, lint, architecture, safety, Build Check, Secret
  Scan, Route Budget, and the exact-head preview. The broad unit run exposed two
  stale source tripwires that still required direct route writes; both now prove
  the atomic RPC ordering and pass 6/6 focused. Required CI is rerunning on the
  repaired head.
- Direct database verification remains blocked because no confirmed Buddy-owned
  Supabase connection is available; no differently owned project was queried.

Post-merge closure:

- With the verified Buddy connection and authorized fixtures, force one failed
  and one successful seal plus one failed and one successful pending-preview
  unseal, proving rollback and returned-row evidence across package, listing,
  and deal state.
- The next independent audit target is seal-admission authority: query-error
  truthfulness in `canSeal`, snapshot assembly, identity gating, and lender
  matching.

## 2026-08-28 — sealed Golden Trident supersession retention

Checkpoint:

- PRs 967, 968, and 969 remain open, clean, mergeable, and exactly current with
  `main`; this database-boundary repair does not modify their marketplace,
  delivery, or artifact-generator files.
- Production deployment `dpl_EQob5PMxWaA85DupqtdKcuaYEi49` is READY on exact
  commit `fe428208311739a0147294d10c1e2d3d4d1ceb2b`, serves `www.buddysba.com`, and recorded no warning,
  error, or fatal logs in the latest two-hour observation window.
- PR 878's Golden Trident code remains deployed. Complete seal-to-marketplace-
  to-lender transactional proof remains blocked on the verified Buddy-owned
  Supabase connection and an authorized sealed transaction.

Evidence and root cause:

- Sealing freezes the certified final bundle id and all three distributed
  artifact paths into `buddy_sealed_packages.sealed_snapshot.tridentFinal`.
- `finalize_trident_bundle_run` superseded every prior current bundle without
  checking that active binding. A run admitted before or after sealing could
  therefore make delivery's current final bundle diverge from the bundle the
  borrower sealed.
- Superseded bundle objects have no ordinary deletion path. PR 969's compensating
  cleanup is correctly limited to objects newly uploaded by the failed attempt.

Repair branch: `codex/commission-sealed-trident-retention`.

Repair:

- Fence replacement final-run admission while an active sealed package exists;
  preview generation remains available.
- Recheck the seal during atomic publication, closing the admission-to-seal
  race.
- Block direct supersession of the exact final bundle referenced by an active
  seal at the database trigger boundary.
- Reconcile historical drift only when seal bundle identity, deal, bank,
  final/succeeded state, and all three artifact paths match exactly.
- Retain every bundle row and storage object; newer unsealed candidates become
  superseded forensic evidence and nothing is deleted.
- Preserve empty-search-path privileged functions and service-role-only factory
  execution.

Verification on code head `6bad26ed647b97dbf6ecf7f014fbe2b20032c032`:

- Focused static regression coverage passed 6/6 locally.
- CI ran 13,483 tests: 13,474 passed, 0 failed, and 9 skipped.
  React-server-condition tests passed 18/18. Research evaluation passed 7/7;
  the 13 known production-data placeholders remain explicitly skipped.
- Typecheck, lint, architecture, safety, legacy-write, polling, Never-500,
  schema-select, report-only schema drift, Build Check, Secret Scan, and public
  Playwright passed. Public Playwright ran 1 test and skipped 5 authenticated
  tests because credentials were unavailable.
- Exact-head Vercel preview `dpl_BPhg9DVHwfCTYuNUpHXxb9gynuLg` is READY,
  returned HTTP 200 with `x-buddy-build` matching the code head, and recorded
  no warning, error, or fatal runtime logs in the two-hour verification window.
- The complete five-file diff was inspected. It contains one forward migration,
  its schema-manifest provenance, one six-case regression guard, and the durable
  commissioning evidence; it deletes no row, object, dependency, or product code.
- This evidence-only ledger commit does not change runtime code. Its resulting
  exact head must retain green required checks and a READY, SHA-matched preview
  before merge recommendation.
- Direct database verification remains blocked because no confirmed Buddy-owned
  Supabase connection is available; no differently owned project was queried.

Post-merge closure:

- With the verified Buddy connection, prove active-seal admission refusal,
  admission-before-seal publication refusal, exact historical reconciliation,
  and authorized retrieval of the frozen business plan, projection workbook,
  and feasibility study.
- The next independent audit target is seal/unseal and listing rollback
  truthfulness, especially zero-row/error proof for compensation and deal-state
  transitions.

## 2026-08-29 — sealed retention rebase after atomic seal deployment

Checkpoint:

- PR 971 merged externally as `38cdb8bc81f6a27d544e22a25bb152be1bb3e9f9`.
  Production deployment `dpl_6521UYXXTnro6ymeXeu86TESxEwT` is READY,
  `www.buddysba.com` returns HTTP 200 with the exact build SHA, and no
  warning, error, or fatal runtime logs were found after deployment.
- PR 970 was rebased onto that main commit and remains the dependent retention
  repair. Because PR 971 deployed migration `20260829003000` first, the
  retention migration was safely renumbered to `20260829010000`; its test and
  schema-manifest provenance follow the same ordered filename.
- The rebase preserves PR 971's atomic seal/unseal RPC manifest entries and
  records all three function revisions from the retention migration.

Exact-head evidence before this ledger-only checkpoint:

- Code head `718b31919eb483b41a00b772955f4b51ec234aba` passed CI with 13,522
  tests: 13,513 passed, 0 failed, and 9 skipped; react-server passed 18/18 and
  research passed 7/7 with 13 controlled production-data placeholders skipped.
- Typecheck, lint, architecture, safety, legacy-write, Never-500, schema-select,
  Build Check, Secret Scan, and public Playwright passed.
- Exact-head preview `dpl_BDhHZavUDRZ9mjYTz818UMxXJvZJ` is READY, returned
  HTTP 200 with a matching `x-buddy-build`, and had no warning, error, fatal,
  or grouped runtime-error evidence in the two-hour verification window.
- The complete five-file diff contains only durable evidence, one schema
  manifest, one six-case regression guard, and one forward non-destructive
  migration; it changes no dependency, credential, provider, or other product.
- PR 970 is mergeable and zero commits behind main. It must not be merged
  automatically.

Remaining closure:

- Full transactional proof for PRs 878, 970, and 971 still requires a verified
  Buddy-owned Supabase connection and an authorized sealed transaction. No
  differently owned or ambiguously owned project was queried.
- After merge and deployment, prove active-seal admission refusal,
  admission-before-seal publication refusal, historical reconciliation, exact
  frozen artifact retrieval, and seal/unseal rollback in the authorized fixture.



## 2026-08-29 — marketplace lifecycle and lender delivery convergence

Production checkpoint:

- PR 970 merged as `e092dc49eeda429f25a9e611d76318792571a660`.
- Vercel production deployment `dpl_6Gz3dBLifEN5XemqVR4HLbnYxNnk` is READY on
  that exact commit; `www.buddysba.com` returns HTTP 200 with the matching
  `x-buddy-build` header.
- No warning, error, or fatal runtime logs appeared in the latest 30-minute
  production window, and no grouped runtime-error cluster appeared in two hours.

Evidence and root causes:

- Marketplace cadence discarded candidate-read database errors and treated
  unproven update success as a completed state transition.
- Listings advanced from `pending_preview` to `claiming` before all matched
  lender messages were durably queued. A queue failure therefore removed the
  listing from the only retry path.
- Lender delivery marked the first provider failure permanently `failed`, while
  the worker selected only `pending` rows. Transient failures and historical
  failed rows could never converge without manual intervention.
- Exhausted delivery failures were hidden behind a successful cron response.

Repair branch: `codex/commission-marketplace-delivery-convergence`.

Repair:

- Fail closed on cadence reads and require returned-row, compare-and-set proof for
  listing open and expiration transitions.
- Queue every matched lender notification before opening a listing. Existing
  cooldown suppression makes a repeated cadence run idempotent.
- Lease and retry pending or historical failed outbox rows up to five attempts,
  then mark only the final failure terminal.
- Return HTTP 503 when a cycle exhausts lender delivery, so Vercel cron and
  observability retain truthful failure evidence.
- Add regression coverage for retry recovery, terminal exhaustion, transaction
  ordering, read-error handling, compare-and-set proof, and cron status.

Validation on code head `240748848a8adae4abd74b6ab04fb56dbc46afc9`:

- 13,527 tests: 13,518 passed, 0 failed, 9 skipped.
- React-server: 18/18; research evaluation: 7 passed, 0 failed.
- Typecheck, lint, architecture, safety, schema-select, report-only drift,
  Never-500, Build Check, Secret Scan, Route Budget, and public Playwright
  passed.
- The seven-file diff was inspected completely; no schema, dependency,
  production-data, or destructive storage change is present.
- Exact-head Vercel preview `dpl_FLokAmzMC6WBmr2XZfi1HiK37Gzt` is READY,
  SHA-matched, HTTP 200, and has no warning/error/fatal logs or grouped runtime
  errors in the two-hour verification window.

Remaining closure dependency:

- PR 878 and the complete seal-to-marketplace-to-lender ceremony still require a
  verified Buddy-owned Supabase connection and an authorized sealed transaction.
  Unverified or non-Buddy connections remain untouched.

## 2026-08-29 — Plaid webhook and transaction-sync truthfulness

Checkpoint:

- PR 973 remains open, fully green, mergeable, and zero commits behind main;
  this repair does not modify its test-deal isolation files.
- PR 972 is deployed in production as
  `9fe4b2471558fbd0e749c0ed6718ae12ea542482`; www.buddysba.com returns
  HTTP 200 and its post-deployment runtime observation windows are clean.
- Complete Golden Trident transactional proof remains blocked on a verified
  Buddy-owned Supabase connection and authorized transaction.

Evidence and root cause:

- Plaid Item lookup discarded database errors and could acknowledge unavailable
  state as an intentionally untracked Item.
- Transaction webhooks returned success when synchronization returned failure.
- Item lifecycle updates ignored errors and zero-row writes.
- Synchronization ignored account, transaction, removal, and cursor write
  failures; it could filter out unmapped transactions and still advance the
  cursor, permanently skipping the delta.

Repair branch: `codex/commission-plaid-webhook-sync-truthfulness`.

Repair:

- Fail closed on unavailable connection state and failed synchronization.
- Prove Item lifecycle writes with returned row and requested status.
- Require every account, transaction, removal, and cursor database operation to
  succeed before cursor advancement.
- Reject missing account mappings and preserve explicit failure evidence.
- Add regression coverage for the complete verified-webhook-to-cursor contract.

Validation on code head `c4dc18b0f70039c29867091486ff6ae7d8add5da`:

- 13,532 tests: 13,523 passed, 0 failed, 9 skipped.
- React-server passed 18/18; research evaluation passed 7/7.
- Typecheck, lint, architecture, safety, schema-select, report-only drift,
  Never-500, Build Check, Secret Scan, Route Budget, and public Playwright
  passed.
- The complete five-file diff was inspected: +299/-18 with no schema,
  dependency, credential, production-data, or cross-product change.
- Exact-head Vercel preview `dpl_5uUPDjUwUTNHGtVnPgHwXEVVHVPr` is READY,
  SHA-matched, HTTP 200, and runtime-clean.
- The final evidence-only head must retain these required checks before merge
  recommendation.

Remaining closure:

- After merge, an authorized Plaid sandbox Item is required to prove verified
  webhook retry, database mutation, and exact cursor convergence end to end.
- PR 878's complete Golden Trident delivery ceremony still requires a verified
  Buddy-owned Supabase connection and authorized transaction.

