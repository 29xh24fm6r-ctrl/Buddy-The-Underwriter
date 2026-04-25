# SBA 30-Min Package — Build Spec Pack

**Created:** April 25, 2026
**Goal:** Close the eight gaps in `SBA_30MIN_GAP_ANALYSIS.md` to ship a borrower experience that produces a complete, SOP 50 10 8–compliant 7(a) package in 30 minutes.

---

## Sprint ordering

| Sprint | Spec file | Sized for | Depends on |
|---|---|---|---|
| 1 | `SPEC-S1-rules-and-bugfixes.md` | 1–1.5 weeks | Nothing |
| 2 | `SPEC-S2-forms-and-plaid.md` | 1.5–2 weeks | S1 |
| 3 | `SPEC-S3-identity-and-esign.md` | 1.5–2 weeks | S2 |
| 4 | `SPEC-S4-credit-pull-and-irs.md` | 1.5–2 weeks | S2, S3 |
| 5 | `SPEC-S5-third-party-and-etran.md` | 1.5–2 weeks | S1, S3 |

Total: 7–10 weeks for one implementer; 4–6 weeks parallelized across two.

---

## Governance — non-negotiable across all specs

1. **Buddy owns canonical state. Omega is advisory only.** No spec writes from Omega into canonical SBA state.
2. **Soft pull only.** No hard credit pull anywhere in this pack. Bank does the hard pull as part of credit decision. FCRA § 1681b(a)(2) compliance.
3. **IAL2 gates e-signature.** No SBA form is signed until signer has passed NIST IAL2. SOP 50 10 8 Appendix 10.
4. **Tenant isolation.** RLS enabled on every new table. Bank-scoped queries. GLBA.
5. **Rules-as-config.** SOP changes are migrations, not TypeScript switches.
6. **No mocking in production paths.** No `// In production this would call X`. Real integrations or structured `{ ok: false, reason }` with surfaced gaps.
7. **Idempotency on every external call.** Key = `sha256(deal_id:request_type:content_hash)`.
8. **Audit everything.** Every signature, ID verification, credit pull, IRS request, third-party order writes a `deal_event` with artifact hash.
9. **Verify before claiming done.** Every spec ends with a verification protocol. Phantom AAR check via GitHub API after every claimed commit.
10. **Stop-and-surface.** When execution evidence contradicts the spec, stop and surface before continuing. (OMEGA-REPAIR rev 3.3 lesson.)

---

## Out of scope for this pack

- Hard credit pull (now or behind feature flag)
- Custom e-sign UI (DocuSeal embed only)
- Real-time IRS transcript pulls (4506-C round-trip is async by IRS design)
- Auto-submission of E-Tran (human approval gate stays)
- Closing notes, security agreements, mortgages (bank-side closing, not SBA package)
- ACH/wire disbursement (bank executes; Buddy never touches funds)
- Full SSN plaintext storage (`ssn_last4` only; vault is separate project)

---

## Cross-sprint conventions

### Migration naming
`YYYYMMDD_<descriptor>.sql`. Sequential within a day with `_a`, `_b` suffixes if needed.

### Table naming prefixes
- `sba_*` — SBA-specific
- `borrower_*` — borrower-facing artifacts (KYC, credit pulls, bank connections)
- `deal_*` — per-deal mutable state
- `third_party_*` — third-party orchestration
- `signed_documents` — singular-concept table

### RLS pattern (every new table)
```sql
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <t>_deny ON public.<t> FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY <t>_select_bank ON public.<t> FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
          WHERE m.bank_id = <t>.bank_id AND m.user_id = auth.uid())
);
```
Service role bypasses RLS. Workers run as service role.

### Module structure
```
src/lib/<domain>/
  index.ts             — public exports
  types.ts             — shared types
  <feature>.ts         — pure logic, no I/O
  <feature>Db.ts       — DB access (supabaseAdmin)
  <feature>Service.ts  — orchestration
  __tests__/           — vitest unit tests
```

### Route pattern
Every `src/app/api/` route:
```ts
export const runtime = "nodejs";
export const maxDuration = 60; // 300 if calling Gemini; 30 minimum
```
Auth via `requireDealAccess(params.dealId)`. Input validated with zod. Output is `{ ok: boolean, ... }` or 4xx with reason code.

### Idempotency key
`sha256(deal_id:request_type:content_hash)` — stored on the request row; checked before external API call.

### Event ledger
Every state change writes:
```ts
await sb.from("deal_events").insert({
  deal_id, bank_id,
  event_type: "<domain>.<verb>",  // e.g., "kyc.verification_completed"
  event_data: { ...artifactRefs, idempotency_key, ... },
});
```

### Pulse fastlane note
D3 (`specs/aar-2026-04-22-test-pack-run-1/spec-d3-fastlane-pulse-silence.md`) is queued. Until D3 ships, every new event domain in this pack emits `pulse.forwarding_failed: pulse_mcp_disabled` once per event. Recommended: ship D3 alongside or before S1.

### Verification protocol (every sprint)
1. `tsc --noEmit` clean
2. `vitest run` clean (new tests pass; existing untouched)
3. Migrations applied to sandbox; schema verified via `information_schema.columns`
4. New routes hit via curl with valid Clerk session; expected response
5. New event types confirmed in `deal_events` after triggering action
6. `BUDDY_PROJECT_ROADMAP.md` updated with sprint completion entry
7. PR opened with `docs/archive/<sprint-id>/AAR.md`
8. **GitHub API verification** — every file in spec exists on `main` after merge (phantom AAR check)

---

## Cross-sprint risk register

| Risk | Mitigation |
|---|---|
| SOP 50 10 8 changes during build | Rules-as-config; new procedural notice = new migration, no TS changes |
| IAL2 vendor outage | Multi-vendor scaffold (S3); per-tenant vendor config |
| IRS 4506-C rate limits | Idempotency + exponential backoff + queue (S4) |
| Plaid SDK breaks | Pin version; integration test on every bump |
| DocuSeal AGPL interpretation | Embed as service, don't fork. Legal review before S3 ships |
| Bank tenant E-Tran cert handling | Per-tenant encrypted cert storage with rotation runbook (S5) |
| SBA form revision | `signed_documents.template_version` captures version signed; re-fielding is 1-day task |
| 90-day form staleness | Background job re-checks signature dates; surfaces gap when ≤30 days from staleness |

---

## End-state borrower journey (end of all 5 sprints)

1. Borrower discovers Buddy Voice (existing — Sprint 2 of borrower voice already shipped)
2. Voice intake captures business + ownership + use of proceeds
3. **NEW (S2):** Plaid OAuth — bank statements pulled in seconds
4. **NEW (S3):** IAL2 verification (Persona) — ID + selfie liveness
5. **NEW (S4):** Soft credit pull with explicit consent — abnormalities surfaced as gaps in Story tab
6. **NEW (S2/S4):** Forms 1919, 1920, 413, 912, 4506-C, 155, 159 auto-filled from canonical state
7. **NEW (S3):** E-sign ceremony via DocuSeal — every form signed with IAL2-verified signer
8. **NEW (S5):** Third-party orders fired in parallel: appraisal, business valuation, Phase I (when triggered)
9. **NEW (S1):** Eligibility evaluated against SOP 50 10 8 + March 2026 procedural notices
10. **NEW (S1, S2):** Sources & Uses three-way tied out; equity injection rules enforced
11. Package PDF assembled per SBA 10-tab structure (existing renderer + new forms)
12. **NEW (S5):** E-Tran XML generated with correct guarantee % per loan size; banker reviews and submits

Borrower experience: 30 minutes to "your part is done." Outstanding async items (IRS, appraisal, valuation, Phase I) tracked with ETAs.

Lender experience: complete package opens in cockpit with every form signed, every fact sourced, every gate evaluated, every credit-bureau abnormality already explained by the borrower in their own words, and the e-Tran XML pre-built waiting for human review.

Regulator experience: every signature has IAL2 evidence; every credit pull has consent record; every fact has provenance back to source; SR 11-7 wall holds.

---

## How to use this pack with Claude Code

1. Open the sprint spec, read end to end
2. Hand to Claude Code: "implement this spec; verify each section's verification protocol; do not mark complete until all protocols pass"
3. After Claude Code reports completion: verify via GitHub API that every listed file exists on `main` (phantom AAR check)
4. Run sprint-end verification protocol locally
5. Open AAR file written at `docs/archive/<sprint-id>/AAR.md`
6. Update `BUDDY_PROJECT_ROADMAP.md`
7. Move to next sprint
