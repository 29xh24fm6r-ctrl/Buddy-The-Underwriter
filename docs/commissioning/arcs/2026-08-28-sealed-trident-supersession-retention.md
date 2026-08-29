# Sealed Golden Trident supersession retention

Date: 2026-08-28

Scope: Buddy The Underwriter only (`29xh24fm6r-ctrl/Buddy-The-Underwriter` and `www.buddysba.com`).

## Evidence and root cause

- PR 878's Golden Trident seal-to-marketplace code is deployed, but complete transactional proof remains blocked on a verified Buddy-owned Supabase connection and an authorized transaction.
- `buildSealedSnapshot` freezes the certified final bundle identity and artifact paths in `buddy_sealed_packages.sealed_snapshot.tridentFinal`.
- `finalize_trident_bundle_run` nevertheless superseded every older current bundle for the deal/mode without checking whether an active seal referenced that exact bundle.
- A final run admitted before or after sealing could therefore make delivery's “current final bundle” diverge from the immutable artifact identity the borrower sealed.
- No Trident retention job or ordinary cleanup path deletes superseded bundle objects. PR 969's compensation is correctly limited to objects uploaded by the current failed attempt.

## Repair

- Fence admission of replacement final runs while an active sealed package exists. Preview generation remains available.
- Recheck the active seal in the atomic finalization RPC, closing the race where sealing occurs after admission but before publication.
- Add a database trigger that blocks direct supersession of the exact final bundle referenced by an active seal.
- Reconcile historical drift only where the active seal proves the bundle id, deal, bank, final/succeeded state, and all three persisted artifact paths.
- Retain every bundle row and every storage object. A newer unsealed candidate becomes superseded forensic evidence; nothing is deleted.
- Keep all privileged functions unavailable to `PUBLIC`, `anon`, and `authenticated`, with service-role execution only for the factory RPCs.

## Verification plan

- Static regression coverage proves admission order, finalization order, the trigger boundary, full historical binding evidence, non-deletion, and function privileges.
- Required CI, build, security, schema, and browser checks must pass on the exact PR head.
- The exact-head Vercel preview must be READY, HTTP 200, SHA-matched, and runtime-clean.

## Production closure

After Matt merges, apply and verify through the confirmed Buddy-owned Supabase project:

1. An active sealed package rejects a replacement final admission.
2. A final run admitted before sealing cannot supersede the sealed bundle at publication.
3. Any historically drifted row is restored only when bundle and artifact-path evidence match exactly.
4. The sealed business plan, projection workbook, and feasibility paths remain retrievable through the authorized lender flow.

No production row, storage object, credential, provider configuration, or non-Buddy system is changed in this branch.
