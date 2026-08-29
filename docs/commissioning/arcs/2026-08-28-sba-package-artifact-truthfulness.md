# SBA Package Artifact Truthfulness Factory

Date: 2026-08-28

## Scope

Buddy The Underwriter only: SBA business-plan PDF rendering, storage persistence,
canonical package-row persistence, authenticated retrieval, and the SBA package
viewer. No database mutations, provider configuration changes, or non-Buddy
systems were used.

## Production and continuation evidence

- PR 878 is merged and its Golden Trident code is deployed. Full
  seal-to-marketplace-to-lender transactional proof remains blocked by a
  verified Buddy-owned Supabase connection and an authorized transaction.
- PR 965 remains open, green, and production-dependent. Production continues
  to serve main commit `fe428208311739a0147294d10c1e2d3d4d1ceb2b` at HTTP 200.
- This arc is independent of PR 965.

## Finding

SBA package generation could return `ok: true` with an empty package id and no
PDF. PDF render and storage-upload errors were explicitly treated as non-fatal,
the canonical `buddy_sba_packages` insert error was ignored, and returned-row
proof was absent. The viewer then sent the raw storage path to
`/api/storage/<path>`, but that route does not exist; the existing generic
signed-url route also targets a different bucket and path contract.

The same surface converted database lookup errors into an apparently empty
package state.

## Root cause

The workflow treated calculations, PDF storage, canonical metadata, and browser
retrieval as independent best-effort steps instead of one artifact contract.

## Repair

- PDF render and upload failures now fail the generation request closed.
- Uploads use unique non-overwriting object keys.
- Version lookup and canonical package insertion require explicit database
  success and returned `id` plus matching `pdf_url`.
- A failed canonical write compensates by removing only the new orphan upload.
- Latest-package and initial-page database failures no longer masquerade as
  empty state.
- A dedicated authenticated route checks deal access, package ownership,
  deal-scoped storage paths, storage existence, and the PDF signature before
  returning a private attachment.
- The viewer uses the canonical package id and never interpolates raw storage
  paths into a URL.

## Validation plan

- Behavioral tests for deal-scoped paths and PDF signatures.
- Source-contract regression coverage for render/upload/row failure semantics,
  compensation, authenticated retrieval, and UI wiring.
- Full repository CI, build, security, schema, and public browser checks.
- Exact-head Vercel preview and runtime-log verification.

## Unresolved production proof

After merge, an authorized SBA fixture must generate a package, prove the
`buddy_sba_packages.pdf_url` row, download the exact PDF through the new route,
and verify the artifact is the same package version. Direct database proof
requires a verified Buddy-owned Supabase connection.

## Next independent target

Audit post-insert SBA form cross-fill persistence and regeneration/version
selection. Cross-fill remains intentionally non-fatal today and requires a
separate transactional design that does not corrupt an otherwise valid PDF
artifact.
