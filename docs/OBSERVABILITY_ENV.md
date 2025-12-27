# Observability Environment Variables

## Sentry Configuration

### Required for Error Monitoring

Add these to your production environment (Vercel/Railway/Fly/etc.):

```bash
# Sentry DSN (get from https://sentry.io/settings/projects/)
SENTRY_DSN=https://YOUR_KEY@o1234567.ingest.sentry.io/YOUR_PROJECT_ID
NEXT_PUBLIC_SENTRY_DSN=https://YOUR_KEY@o1234567.ingest.sentry.io/YOUR_PROJECT_ID

# Sentry project (for source map uploads during build)
SENTRY_ORG=your-org-name
SENTRY_PROJECT=buddy-underwriter

# Sentry auth token (for CI/CD source map uploads)
SENTRY_AUTH_TOKEN=YOUR_AUTH_TOKEN
```

### Optional (Recommended)

```bash
# Environment name
SENTRY_ENVIRONMENT=production

# Sample rate (0.0 to 1.0)
# 0.1 = 10% of transactions traced (reduces quota usage)
SENTRY_TRACES_SAMPLE_RATE=0.1

# Enable/disable in specific environments
NEXT_PUBLIC_SENTRY_ENABLED=true
```

---

## Local Development

For local development, create `.env.local`:

```bash
# Optional: test Sentry locally (not required)
SENTRY_DSN=https://YOUR_KEY@o1234567.ingest.sentry.io/YOUR_PROJECT_ID
NEXT_PUBLIC_SENTRY_DSN=https://YOUR_KEY@o1234567.ingest.sentry.io/YOUR_PROJECT_ID
```

**DO NOT** commit Sentry DSN to git. It's already in `.gitignore` via `.env*.local`.

---

## Getting Sentry Credentials

1. **Sign up**: https://sentry.io/ (free tier includes 5k errors/month)
2. **Create project**: Choose "Next.js"
3. **Copy DSN**: Settings → Client Keys (DSN)
4. **Copy org/project**: Settings → General
5. **Create auth token**: Settings → Auth Tokens → Create Token
   - Scopes: `project:releases`, `project:write`

---

## Vercel Deployment

Add environment variables in Vercel dashboard:

1. Go to project → Settings → Environment Variables
2. Add all `SENTRY_*` and `NEXT_PUBLIC_SENTRY_*` variables
3. Mark as "Production" + "Preview" + "Development" (or selectively)
4. Redeploy

---

## Railway/Fly Deployment

```bash
# Railway
railway variables set SENTRY_DSN=https://...
railway variables set NEXT_PUBLIC_SENTRY_DSN=https://...

# Fly.io
fly secrets set SENTRY_DSN=https://...
fly secrets set NEXT_PUBLIC_SENTRY_DSN=https://...
```

---

## Testing Sentry

### In Development
```bash
npm run dev
# Visit /admin/metrics
# Trigger error: throw new Error("test-sentry") in any route
# Check Sentry dashboard for error
```

### In Production
```bash
# After deploy
curl https://your-domain.com/api/health
# Errors will appear in Sentry dashboard
```

---

## Admin Metrics Page

**No additional env vars needed** - uses existing `audit_compliance_ledger` table.

Access: `https://your-domain.com/admin/metrics`

Requires: Clerk authentication (any logged-in user)

Optional: Add role-based access control in future PR.

---

## Cost Considerations

**Sentry Free Tier**:
- 5,000 errors/month
- 10,000 performance transactions/month
- 50 replays/month

**Upgrade if**:
- >5k errors/month (consider fixing bugs first!)
- Need longer retention (30 days → 90 days)
- Want advanced features (distributed tracing)

**Current setup**: Well within free tier for typical usage.

---

## Security Notes

- ✅ Sentry DSN is safe to expose client-side (rate-limited by Sentry)
- ✅ Auth token must be kept secret (only in CI/CD)
- ✅ Request IDs automatically tagged (correlation)
- ✅ No PII logged by default

---

## Next Steps

1. Sign up for Sentry (5 min)
2. Add env vars to production (5 min)
3. Deploy
4. Trigger test error
5. Verify in Sentry dashboard
6. Access `/admin/metrics` for system stats

**Total setup time**: ~15 minutes
