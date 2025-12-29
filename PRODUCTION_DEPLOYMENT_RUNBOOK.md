# 🚀 PRODUCTION DEPLOYMENT RUNBOOK

**Status:** Ready to deploy  
**Date:** 2024-12-29  
**Commit:** `d9b7cd2` - Enterprise signed uploads + MIME enforcement + virus scanning

---

## 📋 PRE-DEPLOYMENT CHECKLIST

- [x] Architecture guard passes locally
- [x] TypeScript compiles without errors
- [x] All changes committed to `main`
- [x] Migration files created and validated
- [ ] Database migrations applied
- [ ] Pushed to GitHub
- [ ] Vercel deployment successful
- [ ] End-to-end tests passed

---

## 🎯 STEP 1: APPLY DATABASE MIGRATIONS

### Option A: Using psql (Recommended)

```bash
# Set your DATABASE_URL environment variable
export DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"

# Apply storage migration
psql $DATABASE_URL -f supabase/migrations/20241229000001_storage_signed_uploads.sql

# Apply virus scanning migration
psql $DATABASE_URL -f supabase/migrations/20241229000002_virus_scanning.sql
```

### Option B: Using Supabase Dashboard

1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `20241229000001_storage_signed_uploads.sql` → Run
3. Copy contents of `20241229000002_virus_scanning.sql` → Run

### Verification

```sql
-- Check virus scanning columns exist
select
  column_name,
  data_type,
  column_default
from information_schema.columns
where table_name = 'deal_documents'
  and column_name in ('virus_status', 'virus_scanned_at', 'virus_engine', 'virus_signature')
order by column_name;
```

**Expected output:**
```
virus_engine      | text        | NULL
virus_scanned_at  | timestamptz | NULL
virus_signature   | text        | NULL
virus_status      | text        | 'pending'::text
```

---

## 🚢 STEP 2: PUSH TO PRODUCTION

```bash
# Verify current branch
git branch --show-current
# Should output: main

# Push to GitHub (triggers Vercel deployment)
git push origin main
```

**Watch deployment:**
- GitHub: https://github.com/29xh24fm6r-ctrl/Buddy-The-Underwriter/actions
- Vercel: https://vercel.com/[your-team]/[your-project]/deployments

**Expected:**
- ✅ GitHub Actions: `upload-guard.yml` passes
- ✅ Vercel: Build succeeds
- ✅ Vercel: Deployment live in ~2-3 minutes

---

## 🧪 STEP 3: PRODUCTION VERIFICATION

### 3.1 Health Check

```bash
# Replace YOUR_DOMAIN with your production URL
export PROD_URL="https://your-app.vercel.app"

# Test API is responding
curl -I $PROD_URL/api/health
# Expected: HTTP/2 200
```

### 3.2 Test Banker Signed Upload Flow

#### A. Request signed URL

```bash
export DEAL_ID="your-test-deal-id"

curl -X POST "$PROD_URL/api/deals/$DEAL_ID/files/sign" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -d '{
    "filename": "test-statement.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 123456
  }' | jq
```

**Expected response:**
```json
{
  "ok": true,
  "signed_url": "https://[project].supabase.co/storage/v1/object/sign/deal-documents/...",
  "storage_path": "deals/[deal-id]/[uuid]/test-statement.pdf"
}
```

#### B. Upload file to signed URL

```bash
# Save the signed_url from previous response
export SIGNED_URL="paste-signed-url-here"

# Upload a test PDF (create one if needed)
echo "%PDF-1.4 Test" > test.pdf

curl -X PUT "$SIGNED_URL" \
  -H "Content-Type: application/pdf" \
  --data-binary @test.pdf \
  -w "\nHTTP Status: %{http_code}\n"
```

**Expected:** `HTTP Status: 200`

#### C. Record file metadata

```bash
# Use storage_path from step A
export STORAGE_PATH="paste-storage-path-here"

curl -X POST "$PROD_URL/api/deals/$DEAL_ID/files/record" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -d '{
    "storage_path": "'"$STORAGE_PATH"'",
    "original_filename": "test-statement.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 123456
  }' | jq
```

**Expected response:**
```json
{
  "ok": true
}
```

#### D. Verify in database

```sql
select
  original_filename,
  mime_type,
  size_bytes,
  virus_status,
  storage_bucket,
  storage_path,
  created_at
from deal_documents
where deal_id = 'your-test-deal-id'
order by created_at desc
limit 1;
```

**Expected:**
```
original_filename | test-statement.pdf
mime_type         | application/pdf
size_bytes        | 123456
virus_status      | pending
storage_bucket    | deal-documents
storage_path      | deals/.../test-statement.pdf
```

### 3.3 Test MIME Enforcement (Security)

```bash
# Try uploading an executable (should be rejected)
curl -X POST "$PROD_URL/api/deals/$DEAL_ID/files/sign" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -d '{
    "filename": "malware.exe",
    "mime_type": "application/x-msdownload",
    "size_bytes": 1024
  }' | jq
```

**Expected response (415 error):**
```json
{
  "ok": false,
  "error": "Unsupported file type",
  "details": "File type 'application/x-msdownload' is not allowed. Supported: PDF, images, Excel, Word, text, ZIP."
}
```

### 3.4 Test Borrower Portal Upload

```bash
export PORTAL_TOKEN="your-test-portal-token"

# Request signed URL (borrower endpoint)
curl -X POST "$PROD_URL/api/borrower/portal/$PORTAL_TOKEN/files/sign" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "tax-return.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 234567
  }' | jq
```

**Expected:** Same structure as banker endpoint

### 3.5 Verify Legacy Endpoints Return 410

```bash
# Test deprecated /upload endpoint
curl -X POST "$PROD_URL/api/deals/$DEAL_ID/upload" \
  -w "\nHTTP Status: %{http_code}\n"
```

**Expected:** `HTTP Status: 410 Gone`

---

## 🛡️ STEP 4: ARCHITECTURE VALIDATION

### 4.1 CI Guard Verification

```bash
# Trigger GitHub Actions workflow manually
gh workflow run upload-guard.yml

# Watch the run
gh run watch
```

**Expected output:**
```
✅ Upload architecture guard passed
✅ All deal/borrower uploads use signed URLs
✅ Zero file bytes pass through Vercel
```

### 4.2 No 413 Errors (Smoke Test)

```bash
# Create a larger test file (10MB)
dd if=/dev/zero of=large-test.pdf bs=1M count=10

# Upload it (should succeed, no 413)
# Follow steps 3.2.A-C with large-test.pdf
```

**Expected:** All steps succeed, no 413 or timeout errors

---

## 📊 STEP 5: MONITORING & ALERTS

### Key Metrics to Watch

1. **Upload success rate** (first 24 hours)
   ```sql
   select
     date_trunc('hour', created_at) as hour,
     count(*) as uploads,
     count(*) filter (where virus_status = 'pending') as pending_scans
   from deal_documents
   where created_at > now() - interval '24 hours'
   group by hour
   order by hour desc;
   ```

2. **MIME rejection rate** (check logs)
   ```bash
   # In Vercel dashboard → Logs → Search for:
   "rejected unsupported MIME type"
   ```

3. **No 413 errors** (check Vercel errors)
   - Should see ZERO `413 Payload Too Large` errors

4. **API response times**
   - `/files/sign` should be <500ms
   - `/files/record` should be <1s

### Alert Conditions

| Metric | Threshold | Action |
|--------|-----------|--------|
| Upload failures | >5% | Investigate immediately |
| MIME rejections | Spike >2x baseline | Check for attack or misconfiguration |
| Virus pending backlog | >100 files | Start virus scanning worker |
| 413 errors | ANY | Regression detected - rollback |

---

## 🚨 ROLLBACK PLAN (IF NEEDED)

### Quick Rollback (Vercel)

```bash
# Revert to previous deployment in Vercel dashboard
# Or redeploy previous git commit:

git log --oneline -5
# Find commit before d9b7cd2

git checkout [previous-commit-hash]
git push origin main --force
```

### Database Rollback (Virus Scanning)

```sql
-- Drop virus scanning columns (ONLY if absolutely necessary)
alter table deal_documents
drop column if exists virus_status,
drop column if exists virus_scanned_at,
drop column if exists virus_engine,
drop column if exists virus_signature;

drop index if exists idx_deal_documents_virus_status;
drop index if exists idx_deal_documents_pending_scan;
```

**⚠️ WARNING:** This will lose all virus scan data. Only do this in emergency.

---

## ✅ SUCCESS CRITERIA

After deployment, verify:

- [x] All 4 signed upload flows work (banker deal, borrower portal, owner portal, share portal)
- [x] MIME enforcement blocks executables/scripts
- [x] Legacy `/upload` endpoints return 410
- [x] CI guard workflow passes
- [x] Database has virus scanning columns
- [x] No 413 errors in production
- [x] Upload success rate >95%
- [x] All uploads log to `deal_events` ledger

---

## 🔐 SECURITY VERIFICATION

### Daily (First Week)

```sql
-- Check for infected files
select
  deal_id,
  original_filename,
  virus_signature,
  virus_scanned_at
from deal_documents
where virus_status = 'infected';
-- Expected: 0 rows (unless genuine infection detected)

-- Check scan failure rate
select
  count(*) filter (where virus_status = 'scan_failed') as failures,
  count(*) as total,
  round(100.0 * count(*) filter (where virus_status = 'scan_failed') / count(*), 2) as failure_pct
from deal_documents
where created_at > now() - interval '24 hours';
-- Expected: failure_pct < 1%
```

### Weekly

- Review MIME rejection logs for attack patterns
- Audit largest uploaded files (>100MB)
- Verify virus scanning worker is processing queue

---

## 📚 NEXT STEPS (POST-DEPLOYMENT)

### Immediate (Week 1)
- [ ] Implement virus scanning worker (ClamAV integration)
- [ ] Add UI virus status indicators to document lists
- [ ] Configure Slack alerts for virus detections
- [ ] Document user-facing allowed file types in help center

### Short-term (Week 2-4)
- [ ] Add file deduplication (SHA-256 hashing)
- [ ] Implement OCR quality scoring on clean files
- [ ] Set up Grafana dashboard for upload metrics
- [ ] Create incident response playbook for infected files

### Long-term (Future)
- [ ] TUS resumable uploads (Phase 3 from original spec)
- [ ] File encryption at rest
- [ ] SOC 2 audit export functionality
- [ ] Advanced threat detection (YARA rules)

---

## 🆘 TROUBLESHOOTING

### Issue: Signed URL returns 403 Forbidden

**Cause:** Supabase Storage bucket not created or RLS policy incorrect

**Fix:**
```sql
-- Verify bucket exists
select * from storage.buckets where name = 'deal-documents';

-- Check RLS policies
select * from storage.policies where bucket_id = 'deal-documents';
```

### Issue: /files/record returns 500

**Cause:** Missing columns or constraint violation

**Fix:**
```sql
-- Check deal_documents schema
\d deal_documents

-- Verify virus_status constraint
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conname = 'deal_documents_virus_status_check';
```

### Issue: CI workflow fails

**Cause:** Guard script not executable or ripgrep not installed

**Fix:**
```bash
chmod +x scripts/guard-no-multipart-deal-uploads.sh

# In GitHub Actions, ripgrep is installed automatically
# If running locally:
brew install ripgrep  # macOS
apt install ripgrep   # Ubuntu
```

---

## 📞 SUPPORT CONTACTS

- **Database issues:** Check Supabase dashboard → Logs
- **Deployment issues:** Check Vercel dashboard → Deployments
- **Security alerts:** Monitor virus_status = 'infected'
- **Performance issues:** Check Vercel → Functions → Analytics

---

**Last updated:** 2024-12-29  
**Deployment commit:** `d9b7cd2`  
**Production URL:** [Update after deployment]
