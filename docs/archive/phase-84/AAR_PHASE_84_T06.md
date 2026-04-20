# AAR — Phase 84 T-06 — Deal creation idempotency guard

**Date:** 2026-04-20
**Ticket:** T-06 (Wave 2 — Close the truth loop)
**Scope:** Prevent banker re-submit duplicates via RPC + app-layer dedup guard
**Completion event:** `buddy_system_events` id `6069b29d-fcd2-4727-832d-ee96e656d03a`
**Migrations applied:** `phase_84_t06_idempotency_guard_schema`, `phase_84_t06_idempotency_guard_rpc`
**Commits:**
- `fdbf4386` — helper (`src/lib/deals/checkDuplicateDeal.ts`)
- `e0d09687` — mirror schema migration file (dev/staging parity)
- `e548ac24` — RPC replacement migration file
- `02191cd9` — wire helper into `/api/deals/create` + `/api/deals/route.ts`, read `reused` in `createUploadSessionApi.ts`

---

## 1. Investigation trail

v1/v2 spec asserted a 60s window trigger on `/api/deals/create`. Pre-work immediately broke that premise:

- **Routes:** there are not 1 but 5 creation paths. `/api/deals/create`, `/api/deals/bootstrap`, `/api/uploads/sessions`, `/api/deals/route.ts` (POST), plus two intentionally-bypassed bulk tools (`/api/builder/deals/mint`, `/api/sandbox/seed`). The original `/api/deals/new/upload-session` is deprecated (returns 410).
- **Shared atomic path:** `/api/deals/bootstrap` and `/api/uploads/sessions` both call `handleCreateUploadSession` → `deal_bootstrap_create` RPC. Guarding only the app layer leaves that path unprotected against any future caller.
- **Ellmann intervals rule out the 60s window:** the 4 duplicates span 35 min, 16 min, 28 min apart (79 min end-to-end). All from the same banker (`user_3BOoDm5Zobxzi4lWfS4za9LLx41`). Same upload shape (11 files each). A 60s trigger would have caught zero of these. A 30-min window would have caught 1 of 3. 4-hour window catches all 3.
- **Root cause correlates with T-02:** deals 1 & 2 produced 0 facts (classifier stamped everything UNKNOWN → no extraction). Deals 3 & 4 produced 266 / 274 facts. Banker was almost certainly reacting to the T-02 bug — "first upload seemed broken, try again." T-02 fix removes the underlying motivation but the guard still needs to exist for genuine double-clicks + future perceived-failure retries.

---

## 2. Scope corrections from v2 spec

### Correction 1: five routes, not one

| Route | Mechanism | Protected in T-06? |
|---|---|---|
| `POST /api/deals/create` | direct `.insert()` | app-layer helper |
| `POST /api/deals/bootstrap` | `deal_bootstrap_create` RPC | RPC-level |
| `POST /api/uploads/sessions` | `deal_bootstrap_create` RPC (same path) | RPC-level |
| `POST /api/deals/route.ts` | direct `.insert()` | app-layer helper |
| `POST /api/deals/new/upload-session` | 410 deprecated | n/a |
| `POST /api/deals/seed` | in-memory, blocked in prod | n/a |
| `POST /api/builder/deals/mint` | direct `.insert()` | bypassed (bulk tool) |
| `POST /api/sandbox/seed` | direct `.insert()` | bypassed (sandbox) |
| `POST /api/admin/demo/hygiene/reset` | direct `.insert()` | bypassed (demo reset) |

### Correction 2: window value (60s → 4h)

The 60s window in v2 came from the assumption that duplicates are client-side retry bursts. They're not. Real duplicates are bankers re-submitting after minutes (not milliseconds) of waiting to see extraction results. 4h covers the observed Ellmann spread (79 min end-to-end) with 3× headroom, without crossing into "legitimately same-named different deals for different underwriting files" territory. Configurable via `SET app.deal_dedup_window = '2 hours';` at session scope if specific workflows need tighter bounds.

### Correction 3: dedup key must include `created_by_user_id`

v2's `(bank_id, lower(trim(name)))` would generate false positives across bankers (two ops at the same bank creating "Smith LLC" deals on the same day). Adding `created_by_user_id` eliminates that class. Required schema additions (applied out-of-band during pre-work, mirrored in `20260420140000_*` migration):

- `deals.created_by_user_id text` — backfilled from `deal_upload_sessions.created_by_user_id` (earliest session per deal)
- `deals.duplicate_of uuid REFERENCES deals(id)` — soft duplicate pointer
- `idx_deals_dedup_lookup` — partial btree (bank_id, user, normalized name, created_at DESC) WHERE `duplicate_of IS NULL`

---

## 3. Guard shape

**RPC-level (primary) — `deal_bootstrap_create`:**

```sql
IF p_created_by_user_id IS NOT NULL THEN
  SELECT id INTO v_existing_id
  FROM public.deals
  WHERE bank_id = p_bank_id
    AND created_by_user_id = p_created_by_user_id
    AND lower(trim(name)) = lower(trim(p_name))
    AND created_at > now() - v_window   -- default 4h
    AND duplicate_of IS NULL
  ORDER BY created_at DESC
  LIMIT 1;
END IF;

IF v_existing_id IS NOT NULL THEN
  v_deal_id := v_existing_id;
  v_reused := true;
ELSE
  v_deal_id := gen_random_uuid();
  INSERT INTO public.deals (…, created_by_user_id) VALUES (…, p_created_by_user_id);
END IF;

-- Always create a fresh upload session (reused deals get new session
-- identity for traceability; old session may have expired at 30min TTL).
INSERT INTO public.deal_upload_sessions (…);

RETURN QUERY SELECT v_deal_id, v_session_id, v_expires_at, v_reused;
```

**App-layer (mirror) — `src/lib/deals/checkDuplicateDeal.ts`:**

Same predicate shape, fail-open on lookup errors. Called before `.insert()` in `/api/deals/create` and `/api/deals/route.ts`. Keeps the two scopes semantically identical — whichever route a caller hits, the dedup behavior matches.

**`Idempotency-Key` header:** deferred to Phase 84.1 ticket **T-06-B**. The user-scoped window is enough for the current failure mode; an opt-in `Idempotency-Key` header would be a nice-to-have for future explicit clients but adds complexity (dedicated table, key lifecycle, cleanup) without matching evidence today.

---

## 4. Acceptance results (verbatim)

### Acceptance 1: Both migrations tracked

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name LIKE '%phase_84_t06%' ORDER BY version;
```

Result:
```
20260420143540  phase_84_t06_idempotency_guard_schema
20260420143702  phase_84_t06_idempotency_guard_rpc
```
✓

### Acceptance 2–5: RPC dedup behavior

Ran 5 successive `deal_bootstrap_create()` invocations in a DO block, then inspected resulting rows + sessions:

```
id                                    name                  created_by_user_id                 duplicate_of  is_test  sessions
2a1a81da-5694-42b9-9a93-8a563c6fbca1  t06_test_deal_alpha   user_T06_ACCEPTANCE_TEST           null          true     2  ← reused
f1f2c9ef-0538-4810-800d-32bc97b7b30a  t06_test_deal_beta    user_T06_ACCEPTANCE_TEST           null          true     1
cc569a9b-d5d0-4c55-a099-b5ce3ad95ecf  t06_test_deal_alpha   user_T06_ACCEPTANCE_TEST_OTHER     null          true     1
bfa2833d-656f-4fb0-b24b-102a76c57410  t06_test_deal_alpha   user_T06_ACCEPTANCE_TEST           null          true     1  ← diff bank
```

Interpretation (5 calls, 4 deal rows):
- **Test 2a** (fresh alpha, test user, test bank): created deal `2a1a81da`, `reused=false` ✓
- **Test 2b** (same params as 2a): dedup hit — no new deal row, returned `reused=true` and `deal_id=2a1a81da`. Session count on `2a1a81da` = **2** (confirms fresh session created for reused deal) ✓
- **Test 3** (same user+bank, **different name**): created new deal `f1f2c9ef`, `reused=false` ✓
- **Test 4** (same name+bank, **different user**): created new deal `cc569a9b`, `reused=false` ✓ (user scoping works)
- **Test 5** (same name+user, **different bank**): created new deal `bfa2833d`, `reused=false` ✓ (bank scoping works)

### Acceptance 7: Ellmann graph intact

```
id                                     created_at              duplicate_of                           is_test
7d76458d-812e-425d-8fce-1cbe966968a6   2026-04-15 20:50:08     null                                   true
a95c03db-2dcf-49b7-89fe-03cc0e09da71   2026-04-15 21:25:21     7d76458d-812e-425d-8fce-1cbe966968a6   true
7df74c12-62cb-478d-bf5b-3169b85c12f1   2026-04-15 21:41:11     7d76458d-812e-425d-8fce-1cbe966968a6   true
df0c0867-989b-4897-a22c-2d29a0c9584c   2026-04-15 22:09:56     7d76458d-812e-425d-8fce-1cbe966968a6   true
```
✓ Canonical unchanged, 3 dupes still pointed at it after migration + acceptance test runs.

### Acceptance 6: app-layer `/api/deals/create` smoke

Not executed as a live HTTP round-trip (requires Clerk session cookie from a browser). Covered via static typecheck of the wiring + the RPC-level acceptance tests which exercise the same predicate shape. Live smoke test deferred to human verification — same pattern as T-01.

### Cleanup

Test deals (4 rows) + their sessions (5 rows) deleted post-acceptance:

```sql
DELETE FROM deal_upload_sessions WHERE deal_id IN (SELECT id FROM deals WHERE name LIKE 't06_test_deal%');
DELETE FROM deals WHERE name LIKE 't06_test_deal%';
```

---

## 5. Spec deviations

1. **v2 route count wrong.** Spec claimed single `/api/deals/create` target; actual scope is 5 creation routes + 2 RPC-dependent paths. Spec corrected.
2. **v2 window wrong.** 60s would have caught 0 of the 3 Ellmann inter-duplicate intervals. Replaced with 4h default, configurable via `app.deal_dedup_window` session setting. Spec corrected.
3. **v2 dedup key missing user scoping.** `(bank_id, name)` alone generates false positives across bankers. Added `created_by_user_id` to the predicate. Required a small schema migration (column add + backfill) that was applied out-of-band before this ticket started and mirrored in migration `20260420140000_*`. Spec corrected.
4. **v2 trigger-based design replaced with RPC-body + app-layer.** A BEFORE INSERT trigger would have required the RPC to catch + handle the rejection and still return a usable `deal_id`. Moving the check into the RPC body (and mirroring in an app-layer helper for direct-insert routes) lets the RPC return `{ deal_id, reused: true, session_id }` cleanly. Spec corrected.
5. **Return-type change required DROP + CREATE.** `CREATE OR REPLACE FUNCTION` cannot change the OUT-parameter shape (adding `reused boolean`). First apply attempt failed with `42P13: cannot change return type of existing function`. Fixed with `DROP FUNCTION IF EXISTS` before `CREATE`. Migration file updated accordingly.
6. **Earlier out-of-band flagging left the canonical pointing at one of its own duplicates.** Pre-work found `7d76458d` (canonical) had `duplicate_of = 7df74c12` (one of its dupes). Fixed via `UPDATE deals SET duplicate_of = NULL WHERE id = '7d76458d-...'` before migration 1 applied, so the mirror migration's flag-UPDATE was idempotent against clean state.

---

## 6. Deferrals — Phase 84.1 backlog

1. **T-06-B: `Idempotency-Key` header opt-in** for `/api/deals/bootstrap`, `/api/deals/create`, `/api/deals/route.ts`, `/api/uploads/sessions`. Separate `deal_creation_idempotency(key, bank_id) → deal_id` table. Current user-scoped window catches observed failure mode; this is the nice-to-have for well-behaved clients.
2. **Fact re-parenting for the Ellmann cluster.** 1,883 rows across 8 tables (deal_events 1213, deal_financial_facts 540, deal_upload_session_files 44, deal_documents 44, deal_document_items 24, deal_spreads 12, deal_upload_sessions 4, deal_document_snapshots 2). Needs its own ticket — moving facts from duplicate deals to the canonical without breaking referential integrity or event ordering is not a T-06 concern.
3. **Audit every other `.update()` / `.insert()` / `.delete()` call site for in-band-error swallowing** (Bug B pattern from T-02). Already queued from T-02; T-06's RPC-level change does destructure `{ error }` in the helper but old call sites across the codebase probably don't.
4. **Builder / sandbox / demo-reset routes intentionally unprotected** — if they ever acquire real banker callers, revisit.

---

## Next

T-04 (`runRecord` wire-through) and T-05 (checklist taxonomy audit) in parallel per phase execution order.
