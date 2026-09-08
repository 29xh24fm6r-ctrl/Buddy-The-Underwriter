# Unified CRM overhaul

## Product story

A brokerage teammate opens CRM, sees commitments and opportunities, finds a company or person, records the conversation or schedules a task, and continues without losing their place. The existing lead qualification, conversion, lender placement, relationship, communications, and duplicate-management records remain authoritative.

## Delivered surfaces

- One CRM navigation rail and shared responsive design tokens, with access to the rest of Buddy, profile, and sign out. The existing global header is visually suppressed only inside the enabled CRM workspace.
- Today: a dated work queue combining the existing activity overview, active lead next actions, and explainable relationship check-in suggestions. No synthetic revenue, scores, or AI predictions.
- Team tasks: dedicated tenant-scoped open/completed task inventory, 100 per page, independent of activity age; complete, reopen, and reschedule using the existing activities endpoint. Lender follow-ups that are not CRM activities remain in Lender network.
- Companies: card/list views, existing combined filters and company creation, owner names, relationship context, sourced-deal metrics, full record links, and quick-view side panels.
- People: cards, race-safe search results, quick view, activity capture, and named company selection instead of asking users to paste a record ID.
- Pipeline: all existing queues, board/list views, searchable opportunities, short intake, named team assignment, explicit bulk results, and stage menus using the canonical state machine. Full records retain qualification, contact attempts, sequences, and conversion.
- Lenders: step-by-step orientation, optional lending criteria, bank search, responsive placement rows, and confirmation forms for status changes. Visiting a deep link does not silently create a lender profile.
- Message library: purpose search and native-dialog editing. Saving templates does not send messages.
- Duplicate review: inspect both records before choosing the survivor; explicit confirmation and serialization of merges.
- Deal connections: searchable parties and direct links to the canonical deal.

## Boundaries and limits

- The existing production flag `BUDDY_CRM_EXPERIENCE_V2_ENABLED` controls the unified shell, home, pipeline, and company/person quick views. It is already enabled in production. Merge/deployment is a separate release action, not performed by this work.
- Disabling the flag restores the legacy shell/pipeline/directory. Shared safety improvements (task endpoints, company picker code, lender confirmations, template dialog, search race handling) are not all flag-gated; revert the PR for a complete rollback.
- No schema migration, new Next route, provider integration, or automatic outreach. The catch-all activities endpoint adds GET/PATCH while retaining its staff gate and server-resolved brokerage tenant.
- PATCH accepts only a valid task ID and complete/reopen/reschedule. Database updates filter tenant, ID, and kind=task. Missing/foreign/non-task results cannot be acknowledged as a successful update. Updates are last-write-wins; no record-version conflict UI is claimed.
- Today’s focus snapshot still uses the latest 500 activities and at most 8 check-in suggestions. The separate Team tasks inventory is the complete paginated CRM-task source. The current lead API returns at most 200 records per queue; the interface describes loaded counts, not whole-business totals.
- The quick record drawer shows the latest 12 returned activities. Full records preserve existing history and advanced controls. Company/person search uses the existing search API, limited to 20 matches of each kind; lead search lives in the pipeline.
- Unsaved activity/intake drafts are guarded on explicit panel close, ordinary link navigation, and browser unload. Drafts are not persisted to browser storage. No guarantee is made for a browser crash or all programmatic history changes.
- Production validation is required after the user-approved merge. Local fixture behavior does not prove deployed authentication, real database persistence, or production appearance.

## Design references

The interaction direction draws on [Attio navigation and quick actions](https://attio.com/help/reference/productivity-collaborating/navigating-your-workspace), [Attio record workspaces](https://attio.com/help/reference/managing-your-data/records/create-and-view-records), and [Pipedrive activity-first workflows](https://www.pipedrive.com/en/features/activities-goals). Buddy keeps its lending domain, data, and authorization model.

## Verification

- Typecheck passed during implementation; final commit checks are recorded in the PR.
- Focused tests cover canonical stage handling, activity target selection, task validation, tenant/kind query constraints, pagination, error/empty states, and rendered action labels.
- Auth, tenant, and internal-link guards passed.
- An isolated browser harness renders the actual CRM components with fictional records and a fully intercepted fetch implementation. No preview deployment or customer record writes were used. Checked desktop and 390px mobile, drawer opening, failed-save draft retention, confirmed-save history refresh, task complete/reopen, and short lead intake opening its saved record. Initial layout defects found by this exercise were corrected.
- Full repository unit tests and CI remain separate gates. See the PR checks for exact final results.

## Production acceptance after merge

1. Confirm the production deployment SHA matches the merged commit; use `app.buddytheunderwriter.com`, never a preview.
2. Inspect Today, Team tasks, company/person directories, pipeline, lenders, templates, duplicate review, and full records at normal desktop zoom and mobile widths.
3. Check company/person search, keyboard dialog focus/Escape, navigation back to Buddy, filters, and empty/error states.
4. On an explicitly designated test record only, save/reload a note, create/reschedule/complete/reopen a task, and verify storage after a fresh production page load. Do not use a customer record for synthetic tests.
5. Validate intake and lender status changes only with explicitly authorized records and actions. Do not send external messages, merge real duplicates, or convert deals merely for QA.
6. Until those live checks pass, label the release implementation-complete, not production-certified.
