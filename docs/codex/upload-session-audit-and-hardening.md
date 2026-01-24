# Upload Session Audit & Hardening (Codex Agent Spec)

## Context
Users report repeated failures where documents appear to upload successfully
but are not processed (no checklist updates, no AI parsing, no downstream events).

Recent commits intentionally enforced upload sessions:
- "Add canonical upload session API"
- "Enforce upload sessions for deal and portal uploads"

This likely introduced silent failure paths where uploads occur without a valid session.

## Goals
1) Verify upload sessions are REQUIRED and CREATED before every upload.
2) Ensure every upload request is associated with a valid upload_session_id.
3) Ensure post-upload processing ALWAYS runs or fails loudly.
4) Eliminate any path where a file can land in storage without downstream processing.
5) Add minimal, high-signal observability for debugging.

## Hard Guardrails
- DO NOT modify Supabase migrations.
- DO NOT weaken upload-session enforcement.
- DO NOT refactor unrelated UI.
- Prefer invariant checks + explicit errors over silent fallbacks.
- All changes must be minimal and justified.

## Required Audit Steps

### A) Map the Upload Flow
Identify all entry points for uploads:
- Deal uploads (banker)
- Borrower portal uploads
- Guided uploads
- Auto-attach / inbox uploads

For each:
- Where is upload session created?
- Where is session ID passed?
- Where is it validated server-side?

### B) Enforce Session Invariants
For every upload handler:
- If upload_session_id is missing or invalid:
  - FAIL the request (400/401)
  - Return a clear error message
- No fallback behavior allowed.

### C) Verify Post-Upload Processing
Confirm for each upload:
- A DB row is written with upload_session_id
- Reconciliation / checklist logic runs
- AI doc mapping pipeline is triggered

If any step can be skipped, add a guard or explicit error.

### D) Add Observability (Minimal)
Add server-side logging or Buddy ledger events at:
- upload_session.created
- upload.received
- upload.rejected (missing/invalid session)
- upload.process.start
- upload.process.complete
- upload.process.failed

Logs must include:
- upload_session_id
- deal_id
- bank_id
- file_id

### E) Surface Failures to UI
Ensure UI receives:
- Explicit error when upload session missing
- Explicit error when processing fails
- No “success” UI if backend rejects the upload

### F) Validation
- Trace one upload end-to-end in code.
- Ensure there is no silent success path.
- Ensure errors are actionable.

## Deliverables
- One or more commits that:
  - Harden upload-session invariants
  - Add observability
  - Do NOT touch Supabase migrations
- `pnpm -s typecheck` passes
- Clear summary of what was fixed and why

## Out of Scope
- UI polish
- Schema redesign
- New features
- Performance optimization
