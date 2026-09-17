# Buddy system diagnostic — September 17, 2026

## Conclusion

Production is available, but end-to-end lender-package completion is not proven. The latest live run fails credit-memo review because the narrative evidence contract is incomplete and its sources disagree. Repeated prose repair cannot repair missing or contradictory inputs.

This change repairs the confirmed memo data defects using existing funding calculations. It does not add another generation engine or weaken publication/release checks. Production data, financial facts, and review results were not edited to manufacture a pass.

## Evidence and coverage

| Area | Diagnostic result | Evidence / limitation |
| --- | --- | --- |
| Deployment | Healthy | Vercel READY at `08dcb8d98c353caa7702003eed2a21ac59aa8756` (PR 1096); all Buddy production aliases point to that release. |
| Borrower entry | Loads | Browser `/start` renders name/email and secure code entry. A new borrower sign-in/upload/microphone session was not completed in this diagnostic. |
| Staff QA screen | Loads, failure visible | Authenticated QA page shows confirmed assumptions, 2 documents, 33 facts, PASS_WITH_FLAGS, three commissioned providers, and the actual memo failure. |
| Database | Reachable | Read-only direct project queries succeeded; package failure records and confirmed funding are available. |
| Storage | Previous missing-bucket issue resolved | `bank-forms` and `trident-bundles` exist and are private. Earlier run stored all six artifact paths; metadata alone does not prove content correctness. |
| AI providers | Calls succeed; not latest blocker | Prior 24-hour ledger had Google 59 successes/1 failure, OpenAI 29/2, Anthropic 31/1 at inspection. Failures include historical quota exhaustion and aborted calls. Successful calls do not imply acceptable documents. |
| Workflow | Fails closed at memo review | Run `b1f2c666-dd3d-43fb-aa11-59530d78b23b`, started 03:32:48 UTC. Vercel workflow logs independently confirm `canonical_credit` FatalError. Workflow transport returned HTTP 200 while the job failed: HTTP status alone is not a completion test. |
| Memo funding | Confirmed defect; repaired here | $850k loan + $150k confirmed equity funds $1m equipment/working-capital uses. Memo did not read the confirmed assumptions, and its narrative adapter omitted `sources_uses` entirely. |
| Capital assessment | Confirmed disagreement; repaired here | Snapshot lookup said net worth unavailable while the same memo's balance-sheet table had $850k business equity. Use that already-loaded business equity only when the snapshot value is missing. Do not substitute it for personal guarantor worth or cash injection. |
| Recommendation | Incomplete evidence contract; repaired here | Narrative received verdict/headline but omitted rationale, conditions precedent and preliminary coverage caveat. These now accompany the calculated financial verdict. Conditions are distinguished from a final lender approval. |
| Memo cache | Confirmed omission; repaired here | Hash ignored confirmed funding and proceeds edits. Both now contribute with stable key ordering; failed input queries throw instead of producing a misleading cache hash. |
| Preflight | Inefficient ordering; repaired here | Deterministic consistency validation ran after AI generation. It now runs first. |
| Business plan / projections | Existing generators and checks retained | Earlier live run produced stored outputs; prior seller-debt/base-cash narrative repairs remain in main. No new final output was inspected during this diagnostic. |
| Feasibility | Earlier stale-audit defect fixed in PR 1095 | Earlier run got past feasibility after repaired sections were re-audited. This diagnostic retains that change. |
| Artifact reuse / final release | PR 1096 repair retained | Previous failure attached prior files to a fresh, unreviewed source. Grouped source/file adoption is now tested; latest live run stopped before reaching it. |
| Forms and combined delivery | Existing guarded path retained | Existing tests cover applicability, missing files, multiple owners, wrong-deal files and all six bundle members. Signing and final live combined download are not verified here. |

No successful bundle is recorded in the queried database. Historical failed rows include test history; the count must not be interpreted as a count of real borrowers.

## Repairs and boundaries

- Reuse `buildSourcesAndUses` and `buildUseOfProceeds` with confirmed assumptions and the same `deal_proceeds_items` used by the SBA package.
- Keep explicit financial facts authoritative; reject conflicts with confirmed funding before generating prose. Do not infer the borrower's equity contribution from an apparent gap.
- Preserve zero equity, real shortfalls, missing uses, seller financing and other sources. Unknown uses remain unknown.
- Feed the canonical funding block to both generator and institutional reviewer through their shared adapter.
- Preserve recommendation calculation and all release/review gates. A calculated financial recommendation is not a final credit decision.
- Include funding edits in memo staleness detection.

## Acceptance after deployment

1. Run the existing synthetic QA deal through its normal authenticated generation button once.
2. Require a succeeded bundle and passing release gate with all six artifact paths from their actual reviewed sources.
3. Open each output and reconcile $850k loan, $150k cash equity, $1m uses, existing debt, historical versus projected DSCR, covenant floor and base/downside cash disclosures.
4. Inspect the projections assumptions tab and SBA forms; verify the combined download contains exactly the required six files and no failed/missing member.
5. Separately test a borrower session's upload, reviewed assumptions, saved/reloaded answers, actual microphone capture, required signatures and lender handoffs.

The browser previously blocked signed storage downloads by policy. No alternate access method was used to bypass that restriction. File-content inspection remains a separate acceptance requirement; user-downloaded and supplied outputs can be inspected.
