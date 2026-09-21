# Borrower form-completion repair

Production test after #1110: startup validation passed with explicitly labeled forecast evidence. Final bundle 43464b7e-0504-47f4-a11a-48679c5a1049 stopped before narrative generation because Form 1919 lacked owner position, Form 159 lacked the agent-use answer, and Form 722 lacked receipt acknowledgment.

## Changes

- Restore owner.title to the Form 1919 registry and require the canonical agent-use answer for 7(a)/504. Existing transactional SQL already permits both fields; no migration needed.
- Share one borrower completion check between package status, POST admission, and durable workflow. Check every required answer and poster availability/receipt before starting generation.
- Move the existing explicit poster receipt control into Prepare your package. Never infer or manufacture consent.
- Keep borrowers in Prepare your package after the final application answer and focus the preparation checklist; both grouped and individual answer paths preserve access to the poster.
- Link missing questions directly to their existing editors. Refresh readiness after saved-answer revisions or poster receipt without replacing financial drafts.
- When an agent is used, check the existing Form 159 payload builder for recorded fees and agent details. Status reads do not create fees; incomplete configuration is reported explicitly.
- Translate recognized generation failures to fixed borrower instructions. Do not expose renderer payloads, owner IDs, private paths, or internal errors.

## Verification

Focused tests exercise multiple owners, explicit false versus missing agent answers, canonical title/agent SQL persistence and concurrency, poster receipt gating on GET and POST, fee disclosure completeness, sanitized errors, and preparation workflow regressions. Browser regressions cover direct question navigation and acknowledgment-driven readiness on desktop/mobile using isolated fixtures.

Bank acceptance, artifact release gates, financial authority, signatures, lender submission, and document provenance are unchanged. This repair does not establish successful production package generation; after deployment the saved QA application must supply its missing answers and explicitly acknowledge the poster before a new production test. Paid-agent fee/contact configuration must be real, never invented to clear a gate.
