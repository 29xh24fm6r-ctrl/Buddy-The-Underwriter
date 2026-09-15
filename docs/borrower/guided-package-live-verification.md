# Guided package production verification — September 15, 2026

PR #1086 is merged. Production `/api/meta/build` identifies commit `54ad8fa257b1f75be711242e850570d45666aa58`; Vercel deployment `dpl_CAGyJPAooEpGBhTDMbeKopnjJ1aJ` is READY and serves `www.buddysba.com`. All four merge workflows passed.

The direct Supabase connection to Buddy project `sglhiuizgugbnzkymwnk` works even though account-level project discovery omits it. The separate Buddy MCP query tool still returns an internal error. No changes were made to Pulse.

## Applied database changes

- `20260915161948_guided_package_answers`: applied; both RPCs exist and grant execution to `service_role`, with no execution for `anon` or `authenticated`.
- `20260915183324_guided_package_release_reconciliation`: aligns the first migration's MCP-assigned version with the repository version and classifies the unique synthetic verification application as `is_test=true`. The synthetic run identifier is `guided-package-54ad8fa-20260915`.
- All canonical columns used by the answer RPC exist in the live schema.

## Live form inventory

Every PDF below returned HTTP 200 from `/sba-templates/<key>.pdf`; its SHA-256 matched the committed file. This inventory covers Buddy's catalog, not every form used by every SBA program.

| Template | Bytes | Live catalog state |
| --- | ---: | --- |
| SBA 1919 | 478,331 | Active |
| SBA 413 | 383,959 | Active |
| SBA 912 | 966,808 | Active |
| SBA 1244 | 696,403 | Active |
| SBA 148 | 27,249 | Active |
| SBA 148L | 840,205 | Active |
| SBA 155 | 40,606 | Active |
| SBA 601 | 58,222 | Active |
| IRS 4506-C | 245,825 | Active |
| SBA 722 | 77,292 | Active; registered by the overhaul migration |
| SBA 159 | 325,719 | Inactive pending the renderer fix and activation migration |

## Live application checks

Checks used a fresh application created through the public concierge endpoint and its issued borrower session cookie. All identities and answers were explicitly synthetic. No borrower emails or lender submissions were sent.

- The initial checklist loaded with 183 questions and no database read errors.
- Saved the business name, SBA program, requested amount, employee count of zero, agent-used answer of false, and a narrative answer through the live guided-answer endpoint.
- Submitted a reviewed voice transcript through the same endpoint with `source=voice`; the live database retained its source and value.
- Buddy's live review endpoint read the saved narrative and returned a relevant follow-up question.
- A stale edit was rejected; zero remained intact.
- Two owners expanded the checklist to 334 questions with no read errors.
- An owner's cash balance saved to `borrower_applicant_financials`.
- A property labeled D saved successfully; editing it updated the existing row rather than creating a duplicate.
- Form 722 receipt required explicit confirmation, succeeded, and produced one acknowledgment event.
- Independent database reads confirmed the requested amount in both canonical locations, zero/false values, owner count, PFS value, edited property value, voice source, and test classification.

These are HTTP/API and database checks. Actual microphone input, full browser interaction, signatures, uploaded supporting documents, and a fully assembled production package have not been certified.

## Form 159 release dependency

The existing inactive row has the exact SHA-256 of the restored official PDF. Its prior release hold also identified catches in `render159.ts` that silently ignored missing fields. The accompanying fix validates all mapped fields and fails before upload for missing fields or wrong field types. Regression tests exercise the real four-page PDF and deliberately damaged templates.

Deploy this renderer fix first, then apply the `activate_verified_form159` migration. That migration activates only the global row whose path and SHA-256 match the verified asset, preserving other uploaded versions. It has not been applied during this verification.

The brokerage's `banks.settings.form159_agent_name` and `form159_agent_address` are both missing. These require the actual agent's legal identity/address; this verification did not invent them. Fee and lender values remain deal-specific. Business-return IRS 4506-C authorizations still require lender preparation/upload.
