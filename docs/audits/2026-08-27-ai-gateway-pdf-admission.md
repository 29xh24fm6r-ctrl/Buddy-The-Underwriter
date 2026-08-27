# AI gateway PDF admission repair

Date: 2026-08-27

## Scope

Buddy The Underwriter only. This audit used the canonical repository and
production evidence from the Vercel project serving www.buddysba.com. No
other product repository, database, deployment, or infrastructure was
inspected or modified.

## Production evidence

After the Vertex hostname repair deployed, document extraction reached the
AI gateway but a modest PDF was rejected as the generator role's entire
2,000,000-token daily allowance. The error reported zero consumed and zero
reserved tokens, proving admission—not actual provider usage—blocked the job.

## Root cause

The durable budget estimator counted every base64 character as one model
token. Google documents PDF input as 258 tokens per page, with a maximum of
1,000 pages per document. Transport encoding size is therefore not a valid
token estimate and caused normal PDFs to reserve millions of tokens.

Primary contract:
https://ai.google.dev/gemini-api/docs/document-processing

## Repair

- Make gateway admission estimation media-aware and asynchronous.
- Parse valid PDFs with the repository's existing pdf-lib dependency.
- Reserve 258 tokens per parsed page, capped at the provider's 1,000-page
  accepted limit.
- Fail malformed or unreadable PDFs safely to the full 258,000-token
  provider allowance rather than undercounting or treating bytes as tokens.
- Preserve the conservative UTF-8 byte bound for text and existing behavior
  for other inline media.

## Verification

- Regression coverage creates a real two-page PDF and proves transport bytes
  are not counted as model tokens.
- Malformed-PDF coverage proves the estimator fails safely to the provider
  maximum.
- Required repository CI, build, security/schema guards, complete unit suite,
  and public browser smoke must pass on the exact PR head.
- Exact-head Vercel preview must be READY, SHA-matched, and runtime-clean.

## Dependencies and remaining closure

PRs 933 and 934 merged before this branch was created; this repair is based
on their combined main commit and does not modify their Vertex endpoint, OCR
fallback, or database migration files. Production closure requires merge,
deployment, and one authorized document-extraction retry. Direct database
row verification remains blocked because the available Supabase connection
does not identify as Buddy-owned and was not queried or modified.
