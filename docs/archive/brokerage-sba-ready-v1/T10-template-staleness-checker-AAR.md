# Recurring SBA/IRS template staleness checker

**Date:** 2026-07-16
**Why:** the user asked to ingest all necessary SBA forms. Network access to
sba.gov/irs.gov is still blocked in this sandbox (confirmed again this
session via raw `curl`, the proxy status log, the WebFetch tool, and
actually running `scripts/ingest-sba-templates.ts` itself — all four hit
the identical 403). That ingestion needs to happen from an environment
with real network access — the user chose to fix the network policy
itself rather than route around it, "to ensure our documents are always
the latest and not stale." Once that's done, this is the piece that keeps
it that way going forward: a recurring check comparing what's stored
against what sba.gov/irs.gov currently publish, instead of a one-time
ingest that quietly rots.

## What was actually aspirational vs. real going in

`scripts/ingest-sba-templates.ts`'s own header comment already stated the
intended design: *"the renderer refuses to fill a form when the stored
revision no longer matches the SBA-published current revision list."*
Nothing had ever implemented that comparison — there was no live-vs-stored
check anywhere in the codebase. This closes that gap (the comparison and
recording part; see "deliberately not done" below for the renderer-refusal
half).

## A real bug found while refactoring, not just plumbing

The ingestion script's PDF-link regex was hardcoded to
`https://www.sba.gov/sites/...\.pdf` only. **`IRS_4506C`'s source page is
`irs.gov`, not `sba.gov`** — so that one form could never have resolved
even with working network access, script logic aside. This was invisible
until now because this codebase has never had working network access to
either domain to notice the mismatch. Fixed by broadening the pattern to
`https://www\.(?:sba|irs)\.gov/...\.pdf` in the now-shared resolver.
Verified with a dedicated test asserting an irs.gov-shaped link resolves
correctly (a test that would have failed against the original regex).

## What shipped

1. **`src/lib/sba/templates/officialTemplateSources.ts`** — the list of 10
   tracked forms + their source pages, extracted out of the ingestion
   script so it's shared with the new checker. One list, one place to add
   an 11th form later.
2. **`src/lib/sba/templates/resolveCurrentTemplateRevision.ts`** — the
   fetch-page → extract-PDF-link → fetch-PDF → sha256 logic, also
   extracted out of the script (with the irs.gov fix above) so the
   one-off ingester and the recurring checker are asking the exact same
   question the exact same way — a checker with even slightly different
   resolution logic than the ingester could flag false staleness forever.
   Returns the PDF bytes too, so the ingestion script doesn't need a
   second fetch of the same file just to get them again (removed that
   redundant round-trip while refactoring).
3. **`src/lib/jobs/templateStalenessChecker.ts`** — `findTemplateStaleness`
   (compares live sha256 against each `bank_document_templates` row's
   stored `file_sha256`) + `writeTemplateStalenessFindings` (records
   `last_checked_at`/`is_stale` on the row). A resolution failure (network
   error, page structure changed) is reported as `!ok` and deliberately
   does **not** set `is_stale` — "couldn't check" and "checked and it
   changed" are different findings; conflating them would mean a transient
   network hiccup silently flags every form as stale.
4. **Migration** (`20260716_bank_document_templates_staleness_tracking.sql`,
   applied live) — adds `last_checked_at`/`is_stale` to
   `bank_document_templates`. Additive only.
5. **`/api/cron/sba-checks?check=template-staleness`** — new action folded
   into the existing consolidated cron route (same pattern as
   `stale-signatures`/`third-party-overdue`/`etran-cert-expiry`; no new
   route file). Findings log via `console.warn` the same way
   `etran-cert-expiry` already does for this codebase's other
   global-not-deal-scoped concern — no admin-alert sink exists yet for
   either, and building one is out of scope here.
6. **`vercel.json`** — weekly cron entry, Mondays 13:00 UTC (SBA/IRS forms
   don't change often enough to justify checking daily, unlike the
   30-minute `irs-transcripts` poll or the daily signature/cert checks).
7. **`scripts/ingest-sba-templates.ts`** — refactored to import the shared
   source list and resolver instead of duplicating the logic inline.
   Re-ran in `--dry-run` after the refactor for both `SBA_1919` and
   `IRS_4506C` and confirmed it still fails at exactly the same network
   point (403) as before — the refactor changed nothing observable except
   fixing the irs.gov bug.

## Deliberately not done in this pass

The renderer-refusal half of the original design intent ("refuses to fill
a form when stale") — i.e., actually wiring `is_stale` into
`form1919/render.ts` etc. to block rendering — was left alone. Hard-gating
live form generation on this check's result is a bigger, riskier behavior
change than "record and log staleness" (a false positive from a scraper
pattern drift or transient network issue would silently break real form
generation for every deal). Flagged as a natural follow-up once the
checker itself has run successfully a few times and its signal is trusted,
not bundled into this pass.

## Verification

`npx tsc -p tsconfig.json --noEmit` clean. Full `pnpm test:unit`: 11,614
passed, 0 failed (up from 11,604 — 10 new tests, including the dedicated
irs.gov-link regression test). Route count unchanged (765) — folded into
the existing cron dispatcher. `vercel.json` validated as well-formed JSON.
Re-ran the actual (refactored) ingestion script twice against live sba.gov
and irs.gov URLs to confirm identical, correct failure behavior pre- and
post-refactor.

Still blocked on the same thing as everything else vendor/network-related
this session: this environment's outbound policy denies `sba.gov`/`irs.gov`.
Once that's changed (user is handling it), both the one-off ingestion and
this recurring checker will work unattended with no further code changes.
