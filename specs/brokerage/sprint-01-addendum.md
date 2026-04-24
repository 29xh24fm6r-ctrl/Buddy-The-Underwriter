# Sprint 1 Addendum — SUPERSEDED

**This file is no longer current.** It existed as a temporary patch layer over the original base spec. Both are now superseded by:

→ **[`sprint-01-v2-canonical.md`](./sprint-01-v2-canonical.md)**

Do not implement from this file. The v2 canonical spec absorbs every correction this addendum contained, plus three security-hardening changes from external review:

1. `borrower_session_tokens` stores `token_hash` (SHA-256), not raw token.
2. Multi-tier rate limiting on `/api/brokerage/concierge`.
3. Legacy `/api/borrower/concierge` is deprecated-with-logging for 2 weeks, not deleted.

This file is kept only for git history. Delete in a future cleanup PR once all builders have migrated to the v2 canonical.
