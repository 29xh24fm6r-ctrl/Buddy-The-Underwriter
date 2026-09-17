# Borrower experience factory build

This release replaces the primary `/start` presentation with one goal-first borrower workspace. It reuses the existing loan records, form registry, answer-save transaction, upload pipeline, financial engine, generation jobs, signing and submission services. It introduces no second financial calculator or policy-eligibility engine.

## What changes

- Public welcome begins with the borrower's goal. No account or model call is needed to explore public program descriptions. Signing in remains necessary to save an application.
- Five chapters organize the existing questions: Your plan, Your business, Your numbers, Your application, Review & next steps. The complete applicable application map remains available. Optional unrelated topic prompts can be deferred without hiding required fields or saved answers.
- Program explanations cover 7(a), 504 and specialist paths with official sources, explicit limitations and a policy-review date. They do not select a program, promise eligibility, estimate approval odds or invent prices. Existing program selection is moved later.
- One focused answer, contextual help and optional inline Buddy chat replace the stacked intake/checklist and floating chat obstruction. Typed answers save without automatically invoking AI review. AI-assisted review, voice and generation remain explicit actions.
- Saved progress is read from the authoritative snapshot. Failed/mismatched reads cannot clear drafts or establish saved progress. Ordinary drafts survive chapter switches; unsaved protected values block navigation. Unsaved changes warn before leaving.
- Existing owners can be corrected, removed or added. Additions use a stable ID to tolerate retries and cannot overwrite another deal's owner. The existing ownership and identity gates remain active.
- Borrowers can select business-document requests, name a helper, explicitly confirm and create a seven-day scoped upload link using the existing share-link service. They can review assignments and revoke links. Creation validates every requested item against the authenticated deal; the business picker excludes personal-owner requests. No messages are sent automatically.
- Existing uploads are visible on return, with received/processing/attention states. Receipt is not described as reviewed extraction. Upload, personal financial schedules and owner controls stay in their appropriate chapters.
- Reviewed assumptions feed the existing financial model. Manual entry requires no model; borrowers can discard a draft and reload saved assumptions. No synthetic financial values are presented as a completed model.
- Borrower downloads exclude the internal credit memo, including inside the complete archive; authorized lender downloads retain all six deliverables. A borrower archive still requires a successfully completed six-document run.
- The final chapter brings existing review, identity, signatures and submission controls together. A confirmation checkbox precedes the existing sharing action. Test-deal isolation and server submission gates remain intact.
- Assigned-contact help uses the existing contact resolver; where no contact exists, it links to SBA assistance without pretending Buddy has assigned a human. No email is sent by this build.
- New funnel events contain chapter and input-method metadata, not borrower answers or financial values.

## Validation

The committed browser harness renders actual React components and styles against synthetic API responses. It blocks external hosts and exercises desktop/mobile welcome, goal save, failure recovery, draft preservation, resume, option explanations, manual assumptions, discard and navigation into review. It is added to CI and makes no paid model calls. It does not replace authenticated deployed integration testing.

Unit coverage includes question/chapter mapping, false and zero, optional-topic handling, saved response validation, educational routing, package access and owner-add retry/cross-deal behavior. Existing intake transactions and financial/generator regressions remain in the full suite.

## Explicit boundaries and release checks

This is the coordinated borrower-interface implementation, not evidence that every research recommendation has been delivered or that Buddy surpasses competitors. The following still require dedicated completion/validation:

- Scoped helper links are delivered manually by the borrower, not emailed automatically. They disclose only the business name and selected requests, and permit uploads; they do not provide access to existing documents or owner financial statements. Validate the deployed share-link tables and recipient upload path before release.
- Document extraction already feeds the existing evidence pipeline; this release does not add a new per-extracted-field provenance/correction interface.
- Program guidance is educational navigation. Reviewed underwriting eligibility, lender overlays, live quotes and numerical scenario comparisons remain with the existing authorities and require separate product/policy validation.
- The sharing checkbox is a UI confirmation, not a new server-stored legal consent receipt. Existing authorization and sharing records remain authoritative; counsel-approved consent wording and receipt requirements must be resolved before claiming otherwise.
- Validate actual deployed sign-in, new and returning applications, upload persistence, multiple owners, protected identifiers, microphone capture, signature providers and final package submission. These were not exercised against production in this build.
- No fresh AI narrative/package generation was run. Offline tests cannot prove new AI-generated narrative quality or provider availability.
- Conduct borrower comprehension/effort testing and assistive-technology review; no measured usability improvement or WCAG conformance is claimed.
- Reconcile program content against the policy effective October 1, 2026 before representing it as current eligibility advice.

No production data or schema migration is changed by this release.
