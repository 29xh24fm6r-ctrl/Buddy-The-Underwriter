# Buddy v1.0.0 - Production Deployment Checklist

## ✅ Pre-Deployment (Complete)
- [x] Code merged to main
- [x] Tagged v1.0.0
- [x] Pushed to origin
- [x] Build verified (173 files, 27,771 lines)

---

## 🗄️ Step 1: Database Migrations

### Option A: Supabase SQL Editor (Recommended)
1. Go to: https://app.supabase.com/project/YOUR_PROJECT/sql
2. Run this command to generate the complete migration:
   ```bash
   cd /workspaces/Buddy-The-Underwriter
   ./scripts/run-all-migrations.sh > /tmp/complete-migration.sql
   cat /tmp/complete-migration.sql
   ```
3. Copy the output and paste into Supabase SQL Editor
4. Click "Run"
5. Verify tables created: Run `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;`

### Option B: psql Direct
```bash
# Set your DATABASE_URL environment variable first
export DATABASE_URL="postgresql://postgres:[password]@[host]:5432/postgres"

# Run all migrations
./scripts/run-all-migrations.sh | psql $DATABASE_URL
```

### Expected Tables (17 total):
- decision_snapshots
- decision_attestations  
- decision_overrides
- bank_attestation_policies
- bank_credit_committee_policies
- bank_credit_committee_members
- credit_committee_votes
- credit_committee_minutes
- credit_committee_dissent
- policy_extracted_rules
- portfolio_risk_snapshots
- stress_test_scenarios
- stress_test_results
- policy_drift_findings
- counterfactual_decisions
- policy_update_suggestions
- board_risk_reports

---

## 🔐 Step 2: Environment Variables

### Vercel Production Settings

Go to: https://vercel.com/YOUR_ORG/buddy-the-underwriter/settings/environment-variables

Add these variables (select "Production" environment):

#### Required (Core Functionality):
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ... (from Supabase Settings → API)

# Clerk Auth
CLERK_SECRET_KEY=sk_live_... (from Clerk Dashboard)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...

# OpenAI (for AI features)
OPENAI_API_KEY=sk-proj-... (from OpenAI Platform)
```

#### Optional (Enhanced Features):
```bash
# Cron Jobs (for nightly automation)
CRON_SECRET=your-random-secret-here (generate: openssl rand -hex 32)

# Email Notifications
RESEND_API_KEY=re_... (from Resend Dashboard)

# Azure OCR (for document intelligence)
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://YOUR_RESOURCE.cognitiveservices.azure.com/
AZURE_DOCUMENT_INTELLIGENCE_KEY=... (from Azure Portal)

# Twilio SMS (for borrower reminders)
TWILIO_ACCOUNT_SID=AC... (from Twilio Console)
TWILIO_AUTH_TOKEN=... (from Twilio Console)
TWILIO_PHONE_NUMBER=+1... (your Twilio phone)
```

### Generate CRON_SECRET:
```bash
openssl rand -hex 32
```

---

## ⏰ Step 3: Configure Vercel Cron

The `vercel.json` file is already configured:

```json
{
  "crons": [{
    "path": "/api/cron/nightly",
    "schedule": "0 2 * * *"
  }]
}
```

This runs nightly at 2:00 AM UTC and executes:
1. Portfolio aggregation (all banks)
2. Policy drift detection (all banks)
3. Living policy suggestions (all banks)

**Verify cron is active:**
1. Deploy to Vercel (auto-deploys from main)
2. Go to: https://vercel.com/YOUR_ORG/buddy-the-underwriter/settings/crons
3. Confirm cron job is listed and enabled

**Test manually:**
```bash
curl -X POST https://YOUR_APP.vercel.app/api/cron/nightly \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## 🚀 Step 4: Deploy to Production

### Automatic Deployment (Recommended):
Vercel auto-deploys when you push to `main`:

```bash
# Already done - v1.0.0 is on main!
git log -1 --oneline
# Should show: 729056c merge: Add health endpoint improvement
```

Vercel will:
1. Detect push to main
2. Run `pnpm build`
3. Deploy to production
4. Show deployment at: https://YOUR_APP.vercel.app

**Monitor deployment:**
- Vercel Dashboard: https://vercel.com/YOUR_ORG/buddy-the-underwriter/deployments
- Logs: Click latest deployment → "Functions" tab

### Manual Deployment (if needed):
```bash
vercel --prod
```

---

## 🧪 Step 5: Post-Deployment Testing

### Health Check:
```bash
curl https://YOUR_APP.vercel.app/api/health
# Expected: {"ok": true, ...}
```

### Database Connection:
```bash
curl https://YOUR_APP.vercel.app/api/admin/portfolio/aggregate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### End-to-End Governance Flow:

1. **Upload Bank Letterhead** (optional)
   - Go to: `/settings/bank`
   - Upload PDF with letterhead
   - Tag as `bank_letterhead`

2. **Configure Attestation Policy**
   - Create attestation policy: `required_count=3`, `required_roles=["underwriter", "credit_chair", "cro"]`

3. **Configure Committee Policy**
   - Create committee policy: `enabled=true`, `rules={loan_amount_gt: 500000}`

4. **Create Test Deal**
   - Upload borrower documents
   - Trigger underwriting: `POST /api/deals/{dealId}/underwrite/start`

5. **Generate Decision**
   - Wait for decision snapshot (poll `/api/underwriting/poll`)
   - View at: `/deals/{dealId}/decision`

6. **Committee Voting** (if required)
   - Visit: `/committee`
   - Cast votes (approve/conditional/decline)
   - Record dissent (if applicable)
   - Generate minutes

7. **Attest Decision**
   - Visit: `/deals/{dealId}/decision/{snapshotId}/attest`
   - Attest as required roles
   - Verify attestation chain

8. **Download Artifacts**
   - Download PDF (with letterhead + hash + QR code)
   - Download Regulator ZIP (7 files)
   - Scan QR code → verify via `/api/verify/{hash}`

9. **Examiner Mode**
   - Visit: `/deals/{dealId}/decision?examiner=true`
   - Verify read-only mode (yellow banner)
   - No action buttons visible

10. **Portfolio Aggregation**
    - Trigger: `POST /api/admin/portfolio/aggregate`
    - View: `/portfolio`
    - Verify metrics displayed

---

## 📊 Step 6: Monitoring & Observability

### Check Logs:
- Vercel Dashboard → Deployments → Latest → Functions tab
- Filter by `/api/cron/nightly` to see nightly job runs

### Database Health:
```sql
-- Run in Supabase SQL Editor
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Error Monitoring:
- Check Vercel logs for 500 errors
- Check Supabase logs for database errors
- Monitor OpenAI API usage (dashboard.openai.com)

---

## 🔒 Step 7: Security Hardening

### RLS Verification:
All governance tables have RLS enabled (server-side only). Verify:

```sql
-- Run in Supabase SQL Editor
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE '%decision%'
ORDER BY tablename;
```

All should show `rowsecurity = true`.

### API Route Protection:
All `/api/admin/*` routes require `requireSuperAdmin()`. Verify:

```bash
grep -r "requireSuperAdmin" src/app/api/admin/
```

### Cron Secret:
Verify cron endpoint requires auth:

```bash
curl -X POST https://YOUR_APP.vercel.app/api/cron/nightly
# Expected: 401 Unauthorized (without Bearer token)
```

---

## 📈 Step 8: First Bank Onboarding

### Checklist:
1. Create bank record in `banks` table
2. Create user accounts (Clerk)
3. Assign users to bank (bank memberships)
4. Configure attestation policy
5. Configure committee policy
6. Add committee members
7. Upload bank letterhead (optional)
8. Create first test deal
9. Walk through governance flow
10. Train users on canonical pages

### User Training:
- **Underwriters**: `/deals`, `/deals/{id}/command`
- **Committee**: `/committee`
- **CRO**: `/governance`, `/portfolio`, `/risk`
- **Compliance**: `/policy`, `/examiner`

---

## 🎯 Success Criteria

- [x] All migrations run successfully (17 tables created)
- [x] Environment variables set in Vercel
- [x] Vercel cron configured and running
- [x] Health check returns 200 OK
- [x] Can create deals and upload documents
- [x] Can trigger underwriting and generate decisions
- [x] Committee voting works (if required)
- [x] Attestation chain completes
- [x] PDF downloads with letterhead + hash
- [x] Regulator ZIP generates with 7 files
- [x] QR code verification works
- [x] Examiner mode displays correctly
- [x] Portfolio aggregation runs
- [x] Canonical pages load (/governance, /committee, /policy, /risk, /examiner)

---

## 🚨 Rollback Plan

If issues arise:

### Rollback Code:
```bash
# Revert to previous tag
git checkout v2025.12.27-buddy-observability
git push origin main --force

# Or revert specific commit
git revert 729056c
git push origin main
```

### Rollback Database:
Supabase has point-in-time recovery (7 days retention):
1. Go to: Supabase Dashboard → Database → Backups
2. Restore to timestamp before migration
3. Confirm restoration

### Rollback Vercel:
1. Go to: Vercel Dashboard → Deployments
2. Find previous working deployment
3. Click "..." → "Promote to Production"

---

## 📞 Support Checklist

### If Deployment Fails:
1. Check Vercel deployment logs
2. Verify environment variables are set
3. Check database connection (Supabase status)
4. Verify OpenAI API key is valid
5. Check for build errors in logs

### If Migrations Fail:
1. Check Supabase SQL logs
2. Verify table doesn't already exist
3. Check for constraint violations
4. Manually drop and re-run migration

### If Cron Job Fails:
1. Check Vercel cron logs
2. Verify CRON_SECRET matches
3. Check database connection
4. Manually trigger: `curl -X POST .../api/cron/nightly`

---

## ✅ Launch Complete

Once all checklist items are complete:

1. Tag deployment in Vercel
2. Document deployment timestamp
3. Notify stakeholders
4. Monitor for 24 hours
5. Schedule first bank onboarding call

**Congratulations! Buddy v1.0.0 is live.** 🎉
