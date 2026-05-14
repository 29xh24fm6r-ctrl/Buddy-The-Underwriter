# Brokerage Communications Stack Index

> Complete inventory of the 11B–11N comms subsystem.
> Every live send flows through: orchestrator → outbox → adapters.

## Modules

| Phase | Module | Purpose |
|-------|--------|---------|
| 11B | `commsAdapters.ts` | Resend email, Telnyx SMS, Slack webhook adapters. `stub/dry_run/live` modes. |
| 11C | `commsLedger.ts` | Auditable event trail: requested/succeeded/failed/retry/exhausted. Masked recipients. |
| 11C | `commsRetryQueue.ts` | Retry decision logic: 429/5xx retryable, 4xx non-retryable, max 3 attempts, exponential backoff. |
| 11D | `commsOutbox.ts` | Durable outbox: enqueue → claim → send → ledger → retry/exhaust. Idempotency keys. |
| 11E | `borrowerNudges.ts` | Missing-doc nudges: eligibility → plan → enqueue. SMS opt-in required. Daily dedup. |
| 11F | `bankerAlerts.ts` | Banker/broker alerts: 6 purposes. Email + Slack. Daily dedup. |
| 11G | `commsOrchestrator.ts` | Single entrypoint: nudges → alerts → optional outbox processing. Batch mode. |
| 11H | API routes | `POST /api/brokerage/deals/[dealId]/comms/run`, `/comms/outbox/process`, `/comms/batch/run` |
| 11I | `CommsAdminClient.tsx` | Admin UI: mode banner, outbox table, ledger timeline, run controls, batch panel. |
| 11J | `commsCron.ts` + cron route | `POST /api/cron/brokerage/comms/run`. CRON_SECRET auth. Scheduled batch processing. |
| 11K | `commsHardening.ts` | Rate limits, SMS compliance footer, email footer, env readiness panel, metrics. |
| 11L | `commsQaHarness.ts` | 7 deterministic scenarios. Refuses live by default. |
| 11M | `commsReleaseGate.ts` | Release checklist: 10 items. Blocks live without required env + auth. |
| 11N | `commsRollout.ts` | Rollout scripts: readiness, dry-run, live-preflight. |

## Docs

| Document | Purpose |
|----------|---------|
| [brokerage-comms-qa.md](brokerage-comms-qa.md) | QA harness usage, scenarios, safety rules |
| [brokerage-comms-release-checklist.md](brokerage-comms-release-checklist.md) | Required env vars, DNS, Telnyx, SMS compliance, rollout procedure |
| [brokerage-comms-live-rollout.md](brokerage-comms-live-rollout.md) | stub → dry_run → live progression, rollback, emergency disable |
| [brokerage-lifecycle-comms.md](brokerage-lifecycle-comms.md) | Phase 12 lifecycle hooks runbook, call sites, troubleshooting |

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm brokerage:comms:qa` | QA harness (7 scenarios) |
| `pnpm brokerage:comms:readiness` | Release checklist status |
| `pnpm brokerage:comms:dry-run` | Full dry-run verification |
| `pnpm brokerage:comms:live-preflight` | Live mode preflight |
| `pnpm brokerage:comms:regression` | Full regression sweep (Phase 11) |
| `pnpm brokerage:comms:lifecycle-regression` | Lifecycle comms regression (Phase 12) |

## Lifecycle-Triggered Comms (Phase 12)

| Phase | Module | Purpose |
|-------|--------|---------|
| 12A | `commsLifecycleHooks.ts` | Routes 6 lifecycle events to comms pipeline via orchestrator/outbox |
| 12B | Call site wiring | `readiness.ts`, upload routes, `commsOutbox.ts` — fire-and-forget hooks |
| 12C | `commsLifecycleObservability.ts` | Summary, event views, admin UI section, `GET /api/brokerage/comms/lifecycle` |
| 12D | Runbook + regression lock | [brokerage-lifecycle-comms.md](brokerage-lifecycle-comms.md) + 10 regression tests |

**Key invariants:**
- All hooks route through `handleLifecycleHook()` — no direct adapter calls
- `processOutbox=false` always — hooks enqueue only
- Hook failures never block uploads, readiness, or outbox processing
- Idempotency inherited from outbox layer (daily dedup)

**Rollback:** Comment out `void import(...)` at any call site, or set `BROKERAGE_COMMS_MODE=stub`.

See [brokerage-lifecycle-comms.md](brokerage-lifecycle-comms.md) for full runbook.

## Governance

### Send path
All live sends follow exactly one path:
```
orchestrator → outbox → adapters
```
No module calls adapters directly except `commsOutbox.processCommsOutboxItem()`.

### processOutbox gates
Every `processOutbox=true` path is gated:
- API routes require admin auth
- Cron route requires CRON_SECRET
- Release gate blocks live if env incomplete
- Admin UI requires confirmation dialog

### Borrower-facing routes
No new borrower-facing UI routes were added in 11B–11N.
All comms are server-side only (outbox → adapter).

### Emergency rollback
Set `BROKERAGE_COMMS_MODE=stub` to immediately stop all live sends.
No data loss. Outbox items remain pending. Resume by switching back to `live`.
