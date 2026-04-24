# Spec IGNITE-BORROWER-LINKAGE — Auto-Create Borrower on Banker-Upload Ignite

**Date:** 2026-04-24
**Owner:** Matt
**Executor:** Claude Code
**Estimated effort:** 90–120 minutes across 2 batches
**Risk:** Medium-low. Batch 1 changes a critical lifecycle helper. Batch 2 is wizard-side defensive.

---

## TL;DR

The IGNITE wizard is **completely blocked at step 1** for every deal created via `banker_upload`. Test Pack Run 2 is unable to progress on deal `e505cd1c-86b4-4d73-88e3-bc71ef342d94` because of this.

**Symptom:** wizard's first step ("Industry") POSTs to `/api/deals/[dealId]/borrower/update` with the chosen NAICS code, route returns `400 {"ok":false,"error":"no_borrower_linked"}` because `deals.borrower_id` is null. Wizard cannot advance. There is no UI affordance to create the borrower first.

**Root cause:** `igniteDeal()` in `src/lib/deals/igniteDealCore.ts` never creates a borrower row when `source === "banker_upload"`. It seeds the checklist and advances lifecycle. Borrower creation is silently expected to happen elsewhere — but for banker-uploaded deals, it never does.

**Production data confirms recurring pattern.** Of the 11 most-recent deals on the test bank, 10 have `borrower_id IS NULL`. This is not a one-off; this is the default state for banker_upload deals.

**Fix shape (2 batches):**

| Batch | What | Effort |
|---|---|---|
| **1** | Upstream fix: `igniteDeal()` ensures a borrower row when `source === "banker_upload"`, plus one-shot backfill for the 10 existing orphan deals | 60–90 min |
| **2** | Defensive wizard-side retry: if `/borrower/update` returns 400 `no_borrower_linked`, wizard auto-calls `/borrower/ensure` then retries | 30–45 min |

Both batches together unblock Test Pack Run 2.

---

## Pre-implementation verification (MANDATORY before Batch 1)

### PIV-0 — Confirm test deal still in stuck state

```sql
SELECT 
  id,
  name,
  borrower_id IS NULL as no_borrower_linked,
  stage,
  intake_phase,
  created_at::text
FROM deals
WHERE id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94';
```

Expected: `no_borrower_linked = true`, `stage = collecting`, `intake_phase = PROCESSING_COMPLETE`.

If `no_borrower_linked = false`, someone fixed it manually. Pick another orphaned deal from PIV-1.

### PIV-1 — Confirm orphan pattern across recent deals

```sql
SELECT 
  COUNT(*) FILTER (WHERE borrower_id IS NULL) as orphan_count,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE borrower_id IS NULL) / NULLIF(COUNT(*), 0)) as orphan_pct
FROM deals
WHERE bank_id = '2cd15251-ecc7-452a-9a52-f8e88d23ff44'
  AND created_at > NOW() - INTERVAL '30 days';
```

Expected snapshot (taken 2026-04-24): 10 of 11 = 91% orphan rate.

If orphan rate < 50%, this bug is partially fixed elsewhere or affects only certain ignite paths. Stop and surface to refine the spec scope.

### PIV-2 — Confirm `/borrower/ensure` handles "no existing borrower" cleanly

```sql
-- Verify the route's call shape works: source=autofill creates from docs
-- (Use a throwaway deal or a backfill candidate)
SELECT id, name, borrower_id 
FROM deals 
WHERE bank_id = '2cd15251-ecc7-452a-9a52-f8e88d23ff44' 
  AND borrower_id IS NULL
ORDER BY created_at DESC 
LIMIT 5;
```

These are your backfill candidates. Confirm they have document data to autofill from:

```sql
SELECT 
  d.id,
  d.name,
  COUNT(DISTINCT doc.id) as active_docs,
  COUNT(DISTINCT f.id) FILTER (WHERE f.fact_type = 'TAX_RETURN') as tax_return_facts
FROM deals d
LEFT JOIN deal_documents doc ON doc.deal_id = d.id AND doc.is_active = true
LEFT JOIN deal_financial_facts f ON f.deal_id = d.id
WHERE d.bank_id = '2cd15251-ecc7-452a-9a52-f8e88d23ff44'
  AND d.borrower_id IS NULL
GROUP BY d.id, d.name
ORDER BY tax_return_facts DESC NULLS LAST
LIMIT 10;
```

Deals with `tax_return_facts > 0` will autofill cleanly (legal name, EIN, NAICS extracted from K-1s and 1120/1065 returns). Deals with no extracted facts will get `legal_name = "Pending Autofill"` placeholder, which is acceptable.

### PIV-3 — Read the autofillBorrowerFromDocs implementation

```bash
cat src/lib/borrower/autofillBorrower.ts | head -80
```

Confirm the function's signature is what the spec assumes: `autofillBorrowerFromDocs({ dealId, bankId, borrowerId, includeOwners })` returning `{ ok, fieldsAutofilled, ownersUpserted, ... }`. If the signature has drifted, adjust Batch 1 to match.

---

## Batch 1 — Upstream fix in `igniteDeal()` + backfill

### Symptom mapping

| Layer | Behavior today | Behavior after Batch 1 |
|---|---|---|
| `igniteDeal()` `banker_upload` | Seeds checklist, advances lifecycle, **leaves `borrower_id` null** | Same, plus ensures a borrower row exists and is attached |
| `igniteDeal()` `banker_invite` | Same as today (borrower row created via invite flow elsewhere) | Unchanged — only `banker_upload` gets the new ensure-borrower step |
| Existing 10 orphan deals | Cannot use IGNITE wizard | Backfilled to have a borrower row attached, can proceed |
| Wizard step 1 | 400 → blocked | 200 → advances to step 2 |

### Fix — change 1 of 2: extend `igniteDeal` to ensure a borrower

File: `src/lib/deals/igniteDealCore.ts`

Insert a new step between Step 1.5 (ensure core document slots) and Step 2 (advance lifecycle to "intake"):

```ts
// ── Step 1.6: Ensure borrower exists for banker_upload (IGNITE-BORROWER-LINKAGE) ──
// banker_upload deals must have a borrower row before the IGNITE wizard can proceed.
// banker_invite deals get their borrower from the invite flow; skip there.
if (source === "banker_upload") {
  try {
    const { data: dealNow } = await sb
      .from("deals")
      .select("borrower_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!dealNow?.borrower_id) {
      // Try autofill first; falls back to a placeholder borrower if no extractable data.
      // Mirrors the source=autofill path in /api/deals/[dealId]/borrower/ensure.
      const { autofillBorrowerFromDocs } = await import(
        "@/lib/borrower/autofillBorrower"
      );

      // Step a: create a placeholder borrower row
      const { data: newBorrower, error: createErr } = await sb
        .from("borrowers")
        .insert({
          bank_id: bankId,
          legal_name: "Pending Autofill",
          entity_type: "Unknown",
        })
        .select("id, legal_name")
        .single();

      if (createErr || !newBorrower) {
        await ledgerWrite({
          dealId,
          kind: "buddy.borrower.ensure_failed",
          actorUserId: triggeredByUserId,
          input: { source, error: String(createErr?.message ?? "no_data_returned") },
        });
        return { ok: false, error: "borrower_create_failed" } as const;
      }

      // Step b: attach to deal
      const { error: attachErr } = await sb
        .from("deals")
        .update({ borrower_id: newBorrower.id, borrower_name: newBorrower.legal_name })
        .eq("id", dealId);

      if (attachErr) {
        await ledgerWrite({
          dealId,
          kind: "buddy.borrower.attach_failed",
          actorUserId: triggeredByUserId,
          input: { source, borrower_id: newBorrower.id, error: attachErr.message },
        });
        return { ok: false, error: "borrower_attach_failed" } as const;
      }

      await pipelineLog({
        dealId,
        bankId,
        eventKey: "buddy.borrower.created",
        uiState: "done",
        uiMessage: "Borrower placeholder created during ignite",
        meta: { source: "ignite_banker_upload", borrower_id: newBorrower.id },
      });

      // Step c: try autofill from docs (fire-and-forget; placeholder is acceptable if it fails)
      autofillBorrowerFromDocs({
        dealId,
        bankId,
        borrowerId: newBorrower.id,
        includeOwners: true,
      })
        .then(async (autofill) => {
          if (autofill.ok && autofill.fieldsAutofilled.length > 0) {
            await pipelineLog({
              dealId,
              bankId,
              eventKey: "buddy.borrower.autofilled_from_docs",
              uiState: "done",
              uiMessage: `Autofilled ${autofill.fieldsAutofilled.length} fields during ignite`,
              meta: { fields: autofill.fieldsAutofilled, owners: autofill.ownersUpserted },
            });
          }
        })
        .catch(() => {
          // Non-fatal: placeholder borrower is good enough for the wizard to proceed
        });
    }
  } catch (ensureErr: any) {
    // Non-fatal: log and continue. Wizard's defensive retry (Batch 2) catches us.
    console.warn("[igniteDeal] borrower ensure failed (non-fatal)", {
      dealId,
      error: ensureErr?.message,
    });
  }
}
```

**Why fire-and-forget on autofill:** the autofill call reads from extracted facts which may take seconds. Blocking ignite on it would slow the user-facing path. The placeholder borrower row is sufficient for the wizard to proceed — autofill enriches it shortly after.

**Why not just call `/api/deals/[dealId]/borrower/ensure`:** that route requires HTTP auth context. `igniteDeal` runs server-to-server; we'd need to bypass that auth or wire a service-token path. Doing the same logic inline avoids the auth dance.

### Fix — change 2 of 2: backfill existing orphans

Migration file: `supabase/migrations/20260424_backfill_orphan_borrowers.sql`

```sql
-- IGNITE-BORROWER-LINKAGE backfill
-- For every deal with borrower_id IS NULL, create a placeholder borrower
-- row in the same bank and attach it. Subsequent autofill will enrich the
-- placeholder when documents are processed.
--
-- Idempotent: re-runs are no-ops because the WHERE filters out attached deals.
-- Safe: never overwrites an existing borrower_id.

DO $$
DECLARE
  orphan_deal RECORD;
  new_borrower_id UUID;
  total_backfilled INT := 0;
BEGIN
  FOR orphan_deal IN
    SELECT id, bank_id, name
    FROM deals
    WHERE borrower_id IS NULL
      AND bank_id IS NOT NULL
  LOOP
    -- Create placeholder borrower
    INSERT INTO borrowers (bank_id, legal_name, entity_type)
    VALUES (orphan_deal.bank_id, 'Pending Autofill', 'Unknown')
    RETURNING id INTO new_borrower_id;

    -- Attach to deal
    UPDATE deals
    SET borrower_id = new_borrower_id,
        borrower_name = 'Pending Autofill'
    WHERE id = orphan_deal.id
      AND borrower_id IS NULL; -- guard against concurrent attach

    total_backfilled := total_backfilled + 1;
  END LOOP;

  RAISE NOTICE 'IGNITE-BORROWER-LINKAGE backfill complete: % deals backfilled', total_backfilled;
END $$;
```

**Note on autofill for backfilled deals:** the migration only creates placeholder borrowers. Autofill from documents won't run automatically for these. That's acceptable — the banker can either edit the borrower's legal name manually in the wizard, OR a future "re-run autofill" action can be added. **Out of scope for this spec.**

### Tests for Batch 1

- Unit test for `igniteDeal({ source: "banker_upload" })` on a deal without borrower → confirm borrower row created, `deals.borrower_id` set
- Unit test for `igniteDeal({ source: "banker_upload" })` on a deal that already has borrower → confirm no new borrower created (idempotent)
- Unit test for `igniteDeal({ source: "banker_invite" })` → confirm NO borrower created (untouched path)
- Unit test for borrower-create failure path → confirm `{ ok: false, error: "borrower_create_failed" }` returned and ledger event written
- Migration test (if migration tests exist): apply backfill on a fixture with 3 orphan deals + 1 attached deal → confirm 3 backfilled, 1 unchanged

### Verification (V-1)

After deploy + migration apply:

```sql
-- Confirm zero orphans on the test bank
SELECT COUNT(*) FROM deals
WHERE bank_id = '2cd15251-ecc7-452a-9a52-f8e88d23ff44'
  AND borrower_id IS NULL;
```
Expected: 0.

```sql
-- Confirm test deal got a borrower
SELECT id, name, borrower_id, borrower_name FROM deals
WHERE id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94';
```
Expected: `borrower_id` is non-null, `borrower_name = "Pending Autofill"` (or autofilled name if extraction completed).

```sql
-- Confirm wizard now succeeds against /borrower/update
-- (manual test in browser: open IGNITE, complete step 1, confirm advance to step 2)
```

### Rollback

If Batch 1 surfaces issues:

```sql
-- Identify the placeholder borrowers created by backfill
SELECT id, legal_name, created_at
FROM borrowers
WHERE legal_name = 'Pending Autofill'
  AND entity_type = 'Unknown'
  AND created_at >= '2026-04-24'::date;
```

Detach + delete (carefully — this destroys data if the wizard already updated them):

```sql
-- Step 1: identify deals attached to backfill borrowers
WITH backfill_borrowers AS (
  SELECT id FROM borrowers
  WHERE legal_name = 'Pending Autofill'
    AND entity_type = 'Unknown'
    AND created_at >= '2026-04-24'::date
)
SELECT d.id as deal_id, d.name, b.id as borrower_id
FROM deals d
JOIN backfill_borrowers b ON d.borrower_id = b.id;

-- Step 2: only after spot-check, detach
-- UPDATE deals SET borrower_id = NULL WHERE borrower_id IN (SELECT id FROM backfill_borrowers);
-- DELETE FROM borrowers WHERE id IN (SELECT id FROM backfill_borrowers);
```

Don't run the destructive part without spot-checking first.

---

## Batch 2 — Defensive wizard-side retry

### Why this matters even after Batch 1

Belt and suspenders. Batch 1 covers the upstream path, but:
- A future code path could create a deal without going through `igniteDeal()` (e.g., direct DB insert, alternate intake flow)
- The `/borrower/update` route still 400s if `borrower_id` is null. A defensive wizard makes the system self-healing rather than depending solely on upstream correctness.

### Fix

The IGNITE wizard's submission handler for the Industry step needs to:

1. POST to `/api/deals/[dealId]/borrower/update` with the NAICS payload
2. If response is `400 { ok: false, error: "no_borrower_linked" }`:
   - POST to `/api/deals/[dealId]/borrower/ensure` with `{ source: "autofill", include_owners: true }`
   - On success, retry the original `/borrower/update` POST
   - On retry success, advance to step 2
   - On retry failure, surface error to user with "Try again" affordance

3. Any other 400/500 → existing error handling

The component file is somewhere in `src/components/sba/` or `src/components/builder/` (the screenshot showed an "IGNITE Research Readiness" modal). Find it via grep:

```bash
grep -rn 'no_borrower_linked\|/borrower/update' src/components/ --include='*.tsx'
```

Whichever component handles the Industry step's submit, wrap its mutation call with the retry logic. Pseudocode:

```ts
async function submitIndustry(payload: IndustryPayload) {
  const res = await fetch(`/api/deals/${dealId}/borrower/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  
  if (res.status === 400) {
    const body = await res.json();
    if (body.error === 'no_borrower_linked') {
      // Auto-ensure borrower then retry
      const ensureRes = await fetch(`/api/deals/${dealId}/borrower/ensure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'autofill', include_owners: true }),
      });
      
      if (!ensureRes.ok) {
        throw new Error(`borrower_ensure_failed: ${(await ensureRes.json())?.error?.code ?? 'unknown'}`);
      }
      
      // Retry original update
      const retryRes = await fetch(`/api/deals/${dealId}/borrower/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (!retryRes.ok) {
        throw new Error(`borrower_update_failed_after_retry: ${retryRes.status}`);
      }
      
      return retryRes.json();
    }
  }
  
  if (!res.ok) {
    throw new Error(`borrower_update_failed: ${res.status}`);
  }
  
  return res.json();
}
```

### Tests for Batch 2

If the wizard component has test coverage, add:
- Submit succeeds first try → advances to step 2 (regression test)
- Submit returns 400 `no_borrower_linked` → ensure called → retry succeeds → advances to step 2
- Submit returns 400 other error → user sees error message, doesn't advance
- Ensure call fails → user sees error message with retry affordance

If the wizard component has no tests, that's fine — Batch 2 is small enough to verify manually.

### Verification (V-2)

Hard test: clear the test deal's borrower_id manually via SQL, then load IGNITE wizard, complete step 1. Should succeed with no manual intervention.

```sql
-- Force the orphan state
UPDATE deals SET borrower_id = NULL WHERE id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94';
```

Then in browser:
1. Open `/deals/e505cd1c-.../builder`
2. IGNITE wizard opens at step 1
3. Type industry description, pick NAICS, click "Confirm Industry →"
4. Should advance to step 2 (Location) without showing `no_borrower_linked` error

Then re-verify the deal has a borrower:
```sql
SELECT borrower_id FROM deals WHERE id = 'e505cd1c-86b4-4d73-88e3-bc71ef342d94';
```
Expected: non-null.

---

## Out of scope (flagged for future)

These came up during investigation but are NOT in this spec:

1. **9 orphan SAMARITUS borrowers in `borrowers` table** with no deal pointing to them. Likely a different bug in the tax-return extraction path that creates borrower rows without attaching. Worth a separate investigation spec.

2. **Why the test pack regenerates new deals on every run instead of reusing.** That's a Test Pack runner question, not a Buddy code question.

3. **Adding a manual "Edit borrower legal name" affordance to the wizard.** Right now the placeholder name only gets enriched via autofill. If autofill doesn't run, the banker is stuck with "Pending Autofill" as the borrower name. Wizard step 2 or 3 (Deal Name?) might already handle this — confirm during Batch 2 implementation.

4. **`/api/deals/[dealId]/borrower/update` 400 status code.** Per build principle #11 from yesterday, precondition-not-met should be 200 with `{ ok: false, reason }`, not 400. This route is still on the old pattern. Worth a separate small spec to migrate routes that emit precondition-not-met as 4xx to the 200-with-reason pattern.

---

## Outcomes table

| Outcome | What it looks like | Action |
|---|---|---|
| **A. Full success** | Both batches deploy clean, IGNITE wizard advances on test deal, backfill cleaned 10 orphans | Update roadmap, resume Test Pack Run 2 from step 2 (Location) |
| **B. Batch 1 surfaces autofillBorrowerFromDocs signature drift** | TypeScript error on the import call | Adjust the inline call in igniteDeal to match the actual signature; rerun tests |
| **C. Backfill migration creates duplicate placeholders if run twice** | Same deal gets 2 backfill borrowers | Migration's `WHERE borrower_id IS NULL` guard prevents this; verify in tests |
| **D. Batch 2 wizard component is hard to find / refactor** | Grep returns no clear single component | Surface to Matt; we may need to read the wizard's Redux/SWR state more carefully |
| **E. Wizard's `/borrower/update` payload schema differs from what spec assumes** | Body shape mismatch surfaces during real test | Capture actual payload via browser network tab, adjust spec |

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Backfill creates a "Pending Autofill" borrower for a deal that's actually got an extracted name elsewhere | Low | Future re-extract / manual edit fixes; placeholder is recoverable |
| Bank-level uniqueness on `borrowers.legal_name` blocks the placeholder insert | Very low | No such constraint observed; we'd see migration errors immediately |
| `igniteDeal` becomes longer / harder to maintain | Low | The added block is well-isolated and gated on `source === "banker_upload"` |
| Two banker_upload ignites for the same deal create two borrowers | Very low | igniteDeal early-returns if `stage !== "created"`; guard prevents double-fire |
| Wizard's defensive retry logic has timing race with concurrent ensure calls | Low | `/borrower/ensure` is idempotent (returns "already_attached" if borrower exists); retries are safe |

---

## Build principle being captured

> **(12) An ignite/lifecycle helper that "depends on a borrower existing" must either ensure the borrower or refuse to advance.** The original `igniteDeal()` advanced lifecycle to `collecting` without verifying that all downstream UIs would have the data they need. The IGNITE wizard then expected `borrower_id` to be set — leaving every banker_upload deal in a permanent stuck state at wizard step 1. Lifecycle helpers should treat their downstream invariants as preconditions to advance, not assumptions about other code paths. (IGNITE-BORROWER-LINKAGE, 2026-04-24)

---

## Hand-off

Execute Batch 1 first. Verify with V-1 (zero orphans on test bank, test deal has borrower, manual wizard test advances past step 1) BEFORE starting Batch 2.

If V-1 passes cleanly, Batch 2 is belt-and-suspenders insurance — you can ship it but it won't be tested in production until/unless we get into a state where Batch 1's invariant is bypassed. That's still worth shipping because correctness defenses don't cost much.

If Batch 1 gets stuck on PIV-3 (autofillBorrowerFromDocs signature drift), stop and surface — adjust spec rather than guess.

Two commits to main, 1-2 PRs. Both land on top of current `main` HEAD (`41a01941` per the latest AAR).
