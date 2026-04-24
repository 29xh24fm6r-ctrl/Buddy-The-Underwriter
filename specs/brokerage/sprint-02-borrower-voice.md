# Sprint 2 — Borrower Voice (SUPERSEDED)

**This file is a historical draft. Do not use for implementation.**

→ Canonical spec: [`sprint-02-v2-canonical.md`](./sprint-02-v2-canonical.md)

---

## Why this was superseded

This draft was written before a full audit of the existing voice infrastructure. The v2 canonical spec reflects three corrections:

1. **Session mechanics.** The banker token route writes a `deal_voice_sessions` row and returns `sessionId + proxyToken` (not a signed JWT). Borrower voice follows the same pattern. This draft described a JWT-mint approach that doesn't match the existing architecture.

2. **Gateway path.** Gateway lives at `buddy-voice-gateway/` at repo root, not `services/voice-gateway/`. v2 canonical reflects this corrected path consistently.

3. **Wiring target.** `/portal/[token]` is the bank-SaaS borrower portal (different tenant, different auth). Brokerage borrower voice wires into `/start`, which is the brokerage front door built in Sprint 1. v2 canonical corrects this.

Additional improvements in v2 absorbed from round-4 revisions + round-5 external review:

- `actor_scope` column name (instead of `scope`) — semantically disambiguated
- `borrower_concierge_session_id` promoted to first-class FK column (not stashed in metadata jsonb)
- XOR constraints on `deal_voice_sessions` and `voice_session_audits` enforce scope/identity correctness at the DB layer
- Gateway-side fact extraction via `MODEL_CONCIERGE_EXTRACTION` — client cannot inject fabricated facts (S2-2)
- Explicit 401/400/404 pattern with audit trail for every failure mode

Refer to `sprint-02-v2-canonical.md` for the implementation spec.
