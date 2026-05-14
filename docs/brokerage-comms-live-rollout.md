# Brokerage Comms Live Rollout Runbook

## Overview

The comms system progresses through three modes:
1. **stub** — fake sends, no network (default)
2. **dry_run** — fake sends with full pipeline validation
3. **live** — real sends via Resend (email) and Telnyx (SMS)

## Step 1: Stub Verification

```bash
# Verify all modules present and tests pass
pnpm brokerage:comms:readiness
pnpm brokerage:comms:qa
```

Expected: all scenarios pass, readiness shows warnings only (no fails).

## Step 2: Dry-Run Verification

```bash
BROKERAGE_COMMS_MODE=dry_run pnpm brokerage:comms:dry-run
```

This runs:
- Release readiness check
- Full QA harness (7 scenarios)
- Validates no live sends occur

Expected: `DRY-RUN PASSED`

## Step 3: Live Preflight

```bash
BROKERAGE_COMMS_MODE=live pnpm brokerage:comms:live-preflight
```

This checks:
- All required env vars present (Resend, Telnyx, Cron, Clerk)
- Admin auth not in dev fallback
- Lists what would be enabled vs blocked

Expected: `PREFLIGHT PASSED` with all required items listed under "Would enable"

## Step 4: First Live Send

```bash
# Set mode to live
BROKERAGE_COMMS_MODE=live

# Process a single deal manually
curl -X POST https://buddysba.com/api/brokerage/deals/{dealId}/comms/run \
  -H "Content-Type: application/json" \
  -d '{"processOutbox": true}'

# Monitor Resend dashboard for delivery
# Monitor Telnyx dashboard for SMS delivery
```

## Step 5: Enable Cron

```bash
# Verify cron secret
pnpm brokerage:comms:readiness

# Cron endpoint: POST /api/cron/brokerage/comms/run
# Schedule: every 15 minutes recommended
# Auth: Authorization: Bearer ${CRON_SECRET}
```

## Rollback

### To dry_run (stop live sends, keep pipeline running)
```bash
# Set BROKERAGE_COMMS_MODE=dry_run
# Outbox items remain pending — no data loss
# Resume live by switching back
```

### To stub (full stop)
```bash
# Set BROKERAGE_COMMS_MODE=stub
# All sends become fake
# Outbox and ledger data preserved
```

## Emergency Disable

```bash
# Immediately: set BROKERAGE_COMMS_MODE=stub
# This stops all live sends within the next cron cycle
# No data loss — pending items stay pending
# Ledger preserves full audit trail
```

## Audit Trail Locations

| Data | Table |
|------|-------|
| Send attempts | `brokerage_comms_outbox` |
| Event history | `brokerage_comms_ledger` |
| Borrower nudge plans | `brokerage_comms_ledger` (event_type: borrower_nudge_*) |
| Banker alerts | `brokerage_comms_ledger` (event_type: banker_alert_*) |
| Cron runs | `brokerage_comms_ledger` (event_type: brokerage_comms_cron_*) |
| Orchestration | `brokerage_comms_ledger` (event_type: brokerage_comms_orchestration_*) |

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm brokerage:comms:readiness` | Release checklist status |
| `pnpm brokerage:comms:qa` | QA harness (7 scenarios) |
| `pnpm brokerage:comms:dry-run` | Full dry-run verification |
| `pnpm brokerage:comms:live-preflight` | Live mode preflight check |
