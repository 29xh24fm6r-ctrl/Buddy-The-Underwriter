# Brokerage Comms Release Checklist

## Required Environment Variables

| Variable | Required for | Notes |
|----------|-------------|-------|
| `RESEND_API_KEY` | Live email | Resend dashboard → API Keys |
| `BROKERAGE_FROM_EMAIL` | Live email | Must be verified domain in Resend |
| `TELNYX_API_KEY` | Live SMS | Telnyx portal → API Keys |
| `TELNYX_FROM_NUMBER` | Live SMS | E.164 format, registered with Telnyx |
| `TELNYX_MESSAGING_PROFILE_ID` | Live SMS (optional) | If using messaging profiles |
| `CRON_SECRET` | Scheduled runs | Vercel cron or external scheduler |
| `CLERK_SECRET_KEY` | Admin auth | Required for production admin routes |
| `BROKERAGE_COMMS_MODE` | All | `stub` (default) / `dry_run` / `live` |
| `BROKERAGE_BANKER_EMAIL` | Banker alerts | Ops team email address |
| `BROKERAGE_SLACK_WEBHOOK_URL` | Slack alerts (optional) | Slack incoming webhook URL |

## Pre-Live Checklist

### DNS / Domain
- [ ] Resend sending domain verified (SPF + DKIM)
- [ ] `BROKERAGE_FROM_EMAIL` uses verified domain

### Telnyx Sender
- [ ] Phone number registered and active in Telnyx
- [ ] 10DLC registration complete (if US A2P)
- [ ] Messaging profile configured (if applicable)
- [ ] Test SMS sent successfully in dry_run mode

### SMS Compliance
- [ ] Live SMS appends "Reply STOP to opt out."
- [ ] STOP/HELP handling configured in Telnyx dashboard
- [ ] SMS body under 160 chars where possible
- [ ] Borrower opt-in recorded before any SMS

### Admin Auth
- [ ] `CLERK_SECRET_KEY` configured
- [ ] Dev fallback disabled in production
- [ ] Admin routes require `requireSuperAdmin`

### Cron
- [ ] `CRON_SECRET` configured
- [ ] Vercel cron or external scheduler configured
- [ ] Schedule: every 15 minutes recommended

## Rollout Procedure

### 1. Dry Run
```bash
BROKERAGE_COMMS_MODE=dry_run pnpm brokerage:comms:qa
pnpm brokerage:launch --skip-build
```

### 2. Live Rollout
```bash
BROKERAGE_COMMS_MODE=live pnpm brokerage:comms:qa  # with ALLOW_LIVE_COMMS_QA=true
# Verify outbox items are real
# Monitor Resend/Telnyx dashboards for delivery
```

### 3. Rollback
```bash
# Set BROKERAGE_COMMS_MODE=stub to immediately stop all live sends
# Outbox items remain in pending/retry state
# No data loss — resume by switching back to live
```

## Runtime Readiness Check

```bash
pnpm brokerage:launch --skip-build --gate comms_adapters
```

Or programmatically:
```typescript
import { getCommsReleaseReadiness } from "@/lib/brokerage/commsReleaseGate";
const r = getCommsReleaseReadiness();
// r.status: "ready" | "blocked" | "warning"
```
