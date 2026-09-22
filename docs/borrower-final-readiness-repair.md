# Borrower final readiness repair

Preparation and submission now read the existing required-document checklist. A file count or a received flag alone cannot satisfy it: matching evidence must be active, stored, confirmed, free of an explicit processing failure, and cover the configured requested years.

Confirmed pre-opening applications do not require historical business returns or operating profit-and-loss statements. Personal returns remain required. Buddy-generated forms satisfy their matching checklist requests; preparation defers those forms to the existing factory to avoid a circular first-run requirement. Existing waivers remain applicable.

Submission also requires an available financial validation report with PASS or PASS_WITH_FLAGS status. Database and identity-read errors block submission instead of looking like successful empty results.

Borrowers can see the checklist beside uploads and return there from final review. The new read endpoint takes its deal scope from the authenticated borrower session. These checks do not invoke models, write checklist statuses, change financial calculations, or change bank-acceptance release controls.

## Verification

- Network-blocked borrower regression suite, including missing validation, failed database reads, missing tax years, invalid uploads, startup applicability, generated forms, and preparation rejection before queued work.
- TypeScript, changed-file lint, database-column guard, API authentication guard, and diff checks.
- Read-only replay of the QA application's persisted inputs: preparation and submission both correctly block on missing personal returns for 2023, 2024, and 2025. Generated Form 413 satisfies the financial-statement request; pre-opening business-history exemptions apply.

No paid generation or live lender submission was performed. These tests do not certify generated narrative quality, signatures, actual storage-byte retrieval, or every lender's requirements. The existing deal-level checklist and form factory remain the authorities for document applicability and owner-specific form expansion.
