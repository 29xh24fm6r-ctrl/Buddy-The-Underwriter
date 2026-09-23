# Complete lender package evidence delivery

The complete-package ZIP contained only generated outputs. It omitted the uploaded returns and supporting documents already frozen into the factory input snapshot. The separate source-documents manifest resource had no working download route. The ZIP was also returned directly through a Vercel function, exposing larger packages to the platform's response-size limit.

## Delivered behavior

- Complete archives contain the actor's generated files plus source evidence from the exact final bundle bound to the active seal. No live document-list query can silently add newer uploads to an older package.
- Lenders receive all six generated files and eligible borrower/internal/public source documents. Borrowers receive their five generated files and borrower-origin uploads only. System documents and inactive/withdrawn uploads are excluded. The internal memo remains lender-only.
- A separate source-documents ZIP uses the same frozen evidence, authorization, integrity checks and audit path. Both archive types remain locked to borrowers until bank claim, borrower selection and the bound grant are verified.
- Every included source file must match its recorded size and its SHA-256 when one was recorded. Legacy size-only evidence is explicitly identified in the inventory. Missing objects, corrupt generated PDFs/workbooks, mismatched hashes, foreign-tenant evidence and missing frozen metadata fail the download rather than returning a partial package.
- A JSON inventory lists delivered filenames, byte sizes, hashes, source types/years and review status. Pending source review is disclosed rather than represented as acceptance. Storage paths and credentials are omitted.
- Archives use deterministic, actor-specific, content-addressed paths in the existing private `trident-bundles` bucket. Access and seal binding are rechecked after assembly; audit persistence precedes the short-lived signed link. Identical concurrent writes are reused only after proving byte equality.
- The archive API returns a 60-second storage URL. A `redirect=1` option supports browser download links without routing ZIP bytes through the function response. Existing lender/borrower fetch controls consume the signed URL.
- Assembly is bounded to 200 source files and 40 MiB of uncompressed document bytes, below the existing bucket's 50 MiB object limit. Larger packages fail explicitly and require a separate secure-delivery workflow; no partial archive is released.

The existing package generator, financial authority, score, identity, signature, bank-acceptance and QA distribution restrictions are unchanged. There is no schema migration or paid model work.

## Verification

The network-blocked route tests build real PDFs/XLSX and inspect the resulting ZIP. They cover three tax years, opening balance sheet, duplicate/traversal filenames, pending-review evidence, internal-memo exclusion, lender-only evidence, frozen bundle selection, complete and source-only downloads, missing/corrupt files, identity mismatch, archive limits, preview/revoked/wrong-lender grants, unsealed packages, mid-assembly access changes, storage/audit failures and deterministic archive reuse.

The HTTP borrower journey follows signed storage delivery without forwarding cookies, verifies the archive digest, and checks every file against the inventory. Desktop/mobile browser fixtures verify the released download link uses the new delivery contract.

These are internal contract tests. They do not certify newly generated AI narratives, production archive storage/signing, actual lender receipt, identity verification or legal signatures. After deployment, live archive verification still requires a legitimately released package; the synthetic QA application must not be sent to a lender or given fabricated release evidence.

References: https://vercel.com/docs/functions/limitations and https://supabase.com/docs/guides/storage/serving/downloads
