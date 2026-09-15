# Guided borrower loan package

The `/start` borrower workspace opens a persistent question checklist. It combines the canonical SBA field registry with 160 package interview questions, expands owner questions by owner ID, and shows saved, unanswered, confirmation-required, and inapplicable states. The progress bar counts saved answers; it does not certify a completed or approved loan package.

Borrowers can type an answer or speak with Buddy. Spoken text is shown for review. Structured answers require the appropriate selection, number, date, or financing-purpose rows before saving. Sensitive character answers require explicit confirmation, and full SSNs use the existing protected PII intake. Buddy reviews saved non-vault answers without changing their values.

Canonical answers, their confirmation, and their conversation mirror are saved in one database transaction. An optimistic comparison prevents overwriting a changed field. Drafts survive navigation among questions in the open workspace; they are not persisted to browser storage. Financial schedules use separate owner-scoped transactions that update existing rows instead of duplicating them.

The existing ownership editor, document uploads, review, and signature flow remain accessible through “Owners, documents & review.” This panel also contains repeatable notes, securities, and real-estate schedules, Form 722 download/receipt acknowledgment, and the lender handoff.

## Package output changes

- Forms 1919 and 1244 expand per individual instead of silently choosing the first owner.
- Form 413 retains schedule overflow on continuation pages and includes legacy real-estate entries absent from the new schedule.
- Form 912 includes former names and residence-history continuation text.
- Individual IRS 4506-C requests populate a stored spouse tax ID.
- Form 1919 aggregates repeated financing-purpose categories.
- Form 159 previews stay drafts until a real PDF is produced. Applicant identity uses the canonical borrower; agent identity/address come from brokerage settings.
- Package assembly rejects missing PDFs, unfinished items, and a run from another deal. Interview answers are appended in full and supplied to narrative/business-plan generation.
- Trident snapshot version 7 includes the guided answers and personal financial schedules. Saves that change substantive inputs invalidate older admission snapshots.
- Answer counts, uploaded-document counts, identity verification, and financial processing are no longer treated as equivalent completion signals.

## Deployment dependency

Apply `supabase/migrations/20260915161948_guided_package_answers.sql` to **Buddy's** database before deploying the new workspace. The migration adds two service-role-only RPCs, permits more than three labeled properties, and registers the missing Form 159 and Form 722 assets without replacing an existing template. No production database migration was applied during this implementation: the dedicated Buddy connection was unavailable. The unrelated Pulse database must not be used.

The application needs its existing Supabase, voice, PII encryption, and AI gateway configuration. Form 159 needs the brokerage's `banks.settings.form159_agent_name` and `form159_agent_address`, plus its existing fee/lender configuration. These are lender-managed values.

Before release, use a designated test application to save/reload typed and spoken answers, add multiple owners and overflow schedules, complete the existing document/signature flow, and download and inspect the resulting package. Automated transaction tests use PGlite fixtures; they do not prove that production has the same schema or configuration. Local browser verification could not run because the browser download failed.

## Remaining form boundary

The built-in IRS 4506-C generator still produces individual 1040 requests. Business-return transcript authorizations and their authorized signatory/recipient configuration remain a lender preparation and upload step, explicitly stated in the workspace. Lender approvals and legally required signatures are not inferred from interview answers. This change does not certify every form used by SBA across every loan program.

Official restored assets:

- [Form 159](https://legacy.sba.gov/sites/default/files/2022-02/SBA%20Form%20159_2.10.22-508_0.pdf), four pages, 47 mapped AcroForm fields.
- [Form 722](https://legacy.sba.gov/document/sba-form-722-equal-employment-opportunity-statement), two-page English/Spanish poster. The acknowledgment records receipt/review, not proof that the poster has been displayed.
