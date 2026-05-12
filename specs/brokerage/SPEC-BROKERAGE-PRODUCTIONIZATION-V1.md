# SPEC-BROKERAGE-PRODUCTIONIZATION-V1

Status: READY FOR IMPLEMENTATION
Owner: Matt
Implementer: Claude Code / Mobile Claude Code
Repo: Buddy-The-Underwriter

## Mission

Productionize Buddy SBA Brokerage as a first-class product line inside the existing Buddy platform.

This is NOT a greenfield build.
This is NOT a new app.
This is NOT a future autonomy sprint.

The current system already has:
- brokerage marketing components
- canonical brokerage architecture docs
- `banks.bank_kind`
- borrower/session/upload tables
- OCR/document artifacts
- trident/sealed-package tables
- marketplace/rate-card tables
- credit memo and SBA package tables

The task is to make the existing brokerage spine safe and usable for controlled borrower intake.

---

## Absolute Guardrails

DO NOT build:
- self-serve lender onboarding
- multiple brokerages
- non-SBA products
- autonomous lender selection
- portfolio monitoring
- annual reviews
- workouts
- examiner tooling
- Pulse / PEIS / third-brain systems
- crypto collateral systems
- new parallel brokerage entity trees

DO NOT create a new app.
DO NOT create a new `brokerages` table.
DO NOT fork underwriting logic.
DO NOT bypass the existing Buddy deal/document/readiness spine.

Use the existing Buddy system.

---

## Canonical Architecture

Buddy SBA Brokerage = existing Buddy platform + brokerage tenant + borrower funnel + lender marketplace.

Tenant model:
- Use existing `banks` table.
- `banks.bank_kind = 'brokerage'` for the singleton Buddy Brokerage tenant.
- `banks.bank_kind = 'commercial_bank'` for lender tenants.
- Every borrower-funnel brokerage deal belongs to the Buddy Brokerage `bank_id`.

Known live schema:
- `banks.bank_kind` exists.
- default is `commercial_bank`.
- `borrower_session_tokens` exists.
- `rate_limit_counters` exists.
- `deals`, `borrowers`, `deal_upload_sessions`, `deal_documents`, `document_artifacts`, `deal_document_slots`, `buddy_trident_bundles`, `buddy_sealed_packages`, `marketplace_listings`, `marketplace_rate_card` exist.

---

## Implementation Strategy

Work in small vertical slices.

Each slice must:
1. inspect existing code first;
2. reuse existing tables/helpers where available;
3. add tests/guards where possible;
4. avoid speculative platform expansion;
5. leave clear TODOs only for explicitly deferred marketplace phases.

Recommended branch:

```bash
git checkout -b feat/brokerage-productionization-v1
```

---

# Phase 0 — Codebase Discovery / Baseline

Before writing code, inspect these paths and summarize current state in the PR body:

```bash
find src/app -maxdepth 4 -type f | sort | grep -E 'start|portal|lender|brokerage|cockpit|admin|borrower|concierge|upload'
find src/lib -maxdepth 5 -type f | sort | grep -E 'brokerage|borrower|concierge|session|rate|tenant|bank|deal|readiness|upload|document|trident|marketplace|sealed|package'
find specs/brokerage -maxdepth 2 -type f | sort
find supabase -maxdepth 5 -type f | sort | grep -E 'brokerage|borrower|banks|marketplace|session|rate|sealed|trident'
```

Also inspect:

```bash
src/app/page.tsx
src/components/marketing/BrokerageHero.tsx
specs/brokerage/brokerage-master-plan.md
specs/brokerage/sprint-01-v2-canonical.md
```

Acceptance:
- PR body includes a concise current-state inventory.
- No implementation starts before discovery notes are written.

---

# Phase 1 — Brokerage Tenant Helper

Goal: centralize brokerage tenant lookup and prevent hardcoded IDs.

Add or confirm:

```bash
src/lib/tenant/brokerage.ts
```

Required exports:

```ts
export const BROKERAGE_BANK_CODE = "buddy-brokerage";
export const BROKERAGE_BANK_NAME = "Buddy Brokerage";
export const BROKERAGE_BANK_KIND = "brokerage" as const;

export async function getBrokerageBankId(): Promise<string>;
export async function isBrokerageTenant(bankId: string): Promise<boolean>;
export async function assertBrokerageTenant(bankId: string): Promise<void>;
```

Behavior:
- query `banks` by stable code/name/kind;
- never hardcode UUIDs;
- throw clear error if singleton is missing;
- throw clear error if multiple brokerage tenants are found;
- cache only if safe for server runtime;
- server-only module.

If the existing `banks` row does not exist, add an idempotent migration/seed script.

Migration requirements:
- confirm/keep `bank_kind` check constraint;
- insert singleton Buddy Brokerage row if absent;
- do not modify lender tenants.

Suggested SQL pattern:

```sql
insert into public.banks (code, name, bank_kind, is_sandbox)
values ('buddy-brokerage', 'Buddy Brokerage', 'brokerage', false)
on conflict (code) do update
set name = excluded.name,
    bank_kind = excluded.bank_kind;
```

Acceptance:
- no raw brokerage UUIDs in app code;
- helper is used by all new brokerage server routes;
- test/guard verifies helper exists and exports required functions.

---

# Phase 2 — Borrower Session Security

Goal: anonymous borrower sessions are safe enough for controlled intake.

Rules:
- Raw session token lives only in HTTP-only cookie.
- DB stores SHA-256 hash only.
- No raw token persistence.
- Session expiry enforced.
- Session lookup hashes incoming cookie before DB lookup.

Cookie:

```text
buddy_borrower_session
```

Module:

```bash
src/lib/brokerage/session.ts
```

Required exports:

```ts
export async function getOrCreateBorrowerSession(): Promise<BrokerageBorrowerSession>;
export async function getBorrowerSessionFromRequest(): Promise<BrokerageBorrowerSession | null>;
export function hashBorrowerSessionToken(rawToken: string): string;
```

Implementation requirements:
- generate 32-byte random token;
- encode URL-safe;
- hash with SHA-256;
- store only hash in `borrower_session_tokens`;
- set cookie as HttpOnly, Secure, SameSite=Lax, Path=/, expiry 90 days;
- handle missing/expired sessions by creating a new one;
- never log raw token.

RLS/security note:
- `borrower_session_tokens` currently has RLS disabled in live Supabase.
- Do NOT blindly enable RLS unless all server code uses service role and policies are added.
- Add a migration/spec note for final RLS hardening.
- For this phase, ensure public clients never query this table directly.

Acceptance:
- grep confirms no insertion of raw token into DB;
- no raw token appears in logs/events;
- session hash is deterministic for a given token;
- expired sessions are not reused;
- unit test covers hash behavior and cookie-only raw-token rule where practical.

---

# Phase 3 — `/start` Borrower Funnel Shell

Goal: make the broken marketing CTA real.

Current fact:
- Homepage links to `/start`.
- `/start` route is missing.

Add:

```bash
src/app/start/page.tsx
```

Behavior:
- public route;
- no Clerk requirement;
- creates or resumes anonymous borrower session through server helper;
- displays SBA borrower intake shell;
- clear CTA into concierge/intake;
- explains no fee unless loan closes;
- explains Buddy prepares lender package and borrower picks from matched lenders;
- includes privacy/security reassurance;
- must be mobile-first.

Do not build full marketplace here.
Do not expose lender identities here.

Acceptance:
- `/start` renders without auth;
- `/start` creates/resumes session;
- homepage CTA works;
- mobile layout is usable;
- no borrower PII required to load page.

---

# Phase 4 — Brokerage Concierge API Skeleton

Goal: create the safe server entrypoint that can later connect to Gemini reasoning/extraction.

Add or confirm:

```bash
src/app/api/brokerage/concierge/route.ts
```

Required behavior:
- public anonymous endpoint;
- requires/creates borrower session;
- rate limits before any expensive work;
- max message length = 4,000 chars;
- creates or resumes borrower concierge session;
- creates draft brokerage deal only when enough minimal borrower intent exists;
- all created deals use Buddy Brokerage `bank_id`;
- response is structured JSON for UI consumption.

Do NOT call legacy OpenAI concierge.
If model integration is not ready, return deterministic placeholder questions and persist transcript state.

Use Gemini-native model registry only when model integration is added.

Required response shape:

```ts
type BrokerageConciergeResponse = {
  ok: boolean;
  sessionId: string;
  dealId?: string;
  assistantMessage: string;
  nextRequiredFields: string[];
  readinessHint?: string;
};
```

Acceptance:
- endpoint never creates deals under a commercial lender bank_id;
- endpoint rejects oversized messages with 413 or 400;
- endpoint rate limits abusive sessions/IPs;
- no LLM call happens before rate limit and payload validation;
- no raw token persisted.

---

# Phase 5 — Borrower Intake UI

Goal: wire `/start` to the brokerage concierge endpoint.

Add component(s):

```bash
src/components/brokerage/BrokerageStartClient.tsx
src/components/brokerage/BrokerageConciergePanel.tsx
```

UI requirements:
- mobile-first chat/intake panel;
- borrower can describe business/loan need;
- clearly shows progress states:
  - tell us about your loan
  - upload documents
  - Buddy prepares package
  - matched lenders review
  - you pick lender
- no fake claims about lender availability;
- no final credit decision language;
- no promise of SBA approval.

Acceptance:
- user can submit a message;
- response renders;
- errors are friendly;
- rate-limit errors show retry guidance;
- mobile viewport works.

---

# Phase 6 — Upload / Document Readiness Bridge

Goal: connect brokerage intake to existing Buddy document spine rather than creating a parallel upload system.

Inspect existing:

```bash
src/app/api/**/upload*/route.ts
src/lib/**/upload*.ts
src/lib/**/document*.ts
src/lib/**/readiness*.ts
```

Use existing tables:
- `deal_upload_sessions`
- `deal_upload_session_files`
- `document_artifacts`
- `deal_documents`
- `deal_document_slots`
- `deal_document_slot_attachments`

Requirements:
- borrower uploads attach to brokerage deal;
- documents enter existing OCR/classification pipeline;
- readiness/checklist consumes existing document slots/items;
- no new borrower-only document table unless strictly necessary;
- failed upload/OCR states are visible to ops.

Acceptance:
- one test/fake upload can attach to a brokerage deal;
- resulting document can be traced through upload session -> artifact -> deal document/slot;
- failed processing leaves repairable state;
- no duplicate document spine introduced.

---

# Phase 7 — Production RLS / Security Audit Spec

Goal: prepare, not blindly apply, the security hardening plan.

Known live blockers:
- `borrower_session_tokens` RLS disabled.
- `rate_limit_counters` RLS disabled.
- many non-core tables also have RLS disabled.

Create:

```bash
specs/security/SPEC-BROKERAGE-RLS-HARDENING.md
```

Include:
- list of brokerage-critical tables;
- current RLS status;
- intended access model:
  - anonymous borrower via server-only routes;
  - borrower never directly queries session token table;
  - lender only sees matched/listed/redacted rows;
  - Buddy ops can see brokerage tenant rows;
  - service role workers can process jobs;
- exact policy strategy;
- staged migration plan;
- rollback plan.

Do NOT enable RLS blindly in this implementation unless policies are complete and tests prove app does not break.

Acceptance:
- security spec exists;
- PR clearly marks security hardening as launch blocker;
- any newly added table has RLS enabled unless explicitly justified.

---

# Phase 8 — Operational Readiness Dashboard Stub

Goal: give Buddy ops visibility into stuck borrower/deal workflows before real borrowers.

Add or extend internal route:

```bash
src/app/admin/brokerage/listings/page.tsx
```

If admin route framework differs, follow existing admin conventions.

Initial dashboard should show counts only:
- borrower sessions last 24h;
- draft brokerage deals;
- uploads pending OCR;
- failed document jobs;
- unsealed packages;
- sealed packages pending listing;
- marketplace listings by status;
- reminder queue count.

Do not build full marketplace UI here.

Acceptance:
- internal-only route;
- no anonymous access;
- no lender access;
- clear empty states;
- query failures are visible, not swallowed.

---

# Phase 9 — Deferred Marketplace Engine Spec

Do not fully build marketplace engine in this PR unless earlier phases are complete.

Instead create implementation-ready follow-up spec:

```bash
specs/brokerage/SPEC-MARKETPLACE-PREVIEW-CLAIM-PICK-V1.md
```

Must define:
- listing statuses;
- preview window scheduler;
- claim window scheduler;
- three-claim concurrency guard;
- lender matching inputs;
- borrower pick transaction;
- atomic unlock;
- losing lender access revocation;
- signed URL TTL;
- audit log requirements.

Acceptance:
- spec is deterministic enough for next Claude Code pass;
- no future-scope autonomy.

---

# Definition of Ready for First Real Borrower

Buddy SBA Brokerage is NOT ready for a first real borrower until all are true:

- `/start` works unauthenticated on mobile.
- Anonymous borrower session token is cookie-only raw / DB-hashed.
- Borrower can submit intake messages.
- Draft brokerage deal is created under Buddy Brokerage tenant only.
- Borrower can upload docs against that deal.
- Uploads enter existing OCR/document pipeline.
- Readiness/missing-doc state is visible.
- Ops can see stuck/failed borrower workflows.
- RLS hardening plan exists and launch-blocking exposure is resolved or explicitly mitigated.
- 10-15 synthetic borrower deals complete end-to-end without manual DB surgery.

---

# Definition of Done for This PR

Minimum acceptable PR:
- discovery notes in PR body;
- brokerage tenant helper;
- session helper with hash-only DB rule;
- `/start` route shell;
- concierge API skeleton with rate/payload guard;
- mobile borrower intake UI skeleton;
- RLS hardening spec;
- marketplace follow-up spec;
- no future-scope systems added;
- typecheck passes or failures are documented with exact pre-existing cause.

Run before final handoff:

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
```

If full test suite is too heavy on mobile Claude Code, run targeted checks and document skipped checks in PR body.

---

# PR Body Template

```md
## Summary
Productionizes the first controlled borrower-intake slice of Buddy SBA Brokerage inside the existing Buddy platform.

## Current-State Review
- Codebase findings:
- Supabase findings:
- Existing brokerage pieces reused:

## Implemented
- [ ] Brokerage tenant helper
- [ ] Borrower session helper
- [ ] /start route
- [ ] Concierge API skeleton
- [ ] Intake UI shell
- [ ] RLS hardening spec
- [ ] Marketplace follow-up spec

## Not Implemented / Deferred
- Self-serve lender onboarding
- Full marketplace claim engine
- Autonomous selection
- Portfolio/monitoring systems

## Security Notes
- borrower_session_tokens:
- rate_limit_counters:
- RLS launch blockers:

## Tests
- [ ] pnpm typecheck
- [ ] pnpm lint
- [ ] pnpm test:unit

## Definition of Ready for First Borrower
- Remaining blockers:
```
