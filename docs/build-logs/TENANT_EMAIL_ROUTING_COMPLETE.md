# Tenant Email Routing System - COMPLETE

**Status:** ✅ SHIPPED (Dec 27, 2025)  
**Ledger:** `docs/buddy-ledger.md` (single canonical table)

## What Was Built

### 1. Database Layer
**Migration:** `supabase/migrations/20251227185822_tenant_email_routing.sql`
- Table: `public.tenant_email_routing`
- Tenant key: `bank_id` (UUID, unique index)
- Fields:
  - `contact_to_email` (destination inbox)
  - `outbound_from_email` (verified sender)
  - `reply_to_mode` ('submitter' | 'configured')
  - `configured_reply_to_email` (optional)
  - `is_enabled` (boolean)
- RLS: deny-all (server-side tenant checks via `supabaseAdmin()`)
- Trigger: `set_updated_at()` (reuses existing)

### 2. Business Logic
**Tenant Routing Accessor:** `src/lib/email/tenantRouting.ts`
- `loadTenantEmailRouting()` - DB-first routing with env fallback
- Uses `getCurrentBankId()` for tenant resolution
- Allowlist guard: `ALLOWED_OUTBOUND_FROM_EMAILS` (prod safety)
- Returns `null` if:
  - User not authenticated
  - No config for bank
  - Config disabled
  - FROM not in allowlist

**Env Fallback:** `src/lib/email/env.ts`
- `resolveEnvFallbackEmailRouting()` - dev baseline
- FROM: `EMAIL_FROM` → `OUTBOUND_FROM_EMAIL`
- TO: `CONTACT_TO_EMAIL` → `EMAIL_TO` → `OUTBOUND_TO_EMAIL` → `NOTIFY_EMAIL` → `SUPPORT_EMAIL`
- REPLY_TO: `REPLY_TO_EMAIL` → `SUPPORT_REPLY_TO`

### 3. API Routes
**Contact Form API:** `src/app/api/contact/route.ts`
- DB routing first, env fallback second
- Reply-to priority: submitter email > tenant config > env fallback
- Friendly error messages with debug output

**Admin API:** `src/app/api/admin/tenant/email-routing/route.ts`
- GET: View current tenant routing config
- POST: Upsert tenant routing config (bank_id from `getCurrentBankId()`)
- Auth: `requireSuperAdmin()`
- Validation: contact_to_email and outbound_from_email required

### 4. Admin UI
**Page:** `src/app/(app)/admin/email-routing/page.tsx`
- Client component with form UI
- Fields:
  - Contact TO (destination inbox)
  - Outbound FROM (verified sender)
  - Reply-To mode (submitter vs configured)
  - Configured Reply-To (if mode=configured)
  - Enabled toggle
- Auto-loads current config on mount
- Save button with loading/error states

### 5. Testing
**Smoke Test Script:** `smoke-test-email-routing.sh`
- Test 1: Contact API with env fallback
- Test 2: Admin API GET routing
- Instructions for tenant routing test

## Architecture

### Routing Resolution Flow
```
Contact Form Submit
    ↓
POST /api/contact
    ↓
loadTenantEmailRouting() ← getCurrentBankId()
    ↓                          ↓
    ↓                    bank_memberships
    ↓                          ↓
tenant_email_routing      bank_id
    ↓
FROM = tenant.outbound_from_email ?? env.EMAIL_FROM
TO = tenant.contact_to_email ?? env.CONTACT_TO_EMAIL
REPLY-TO = submitter ?? tenant.configured_reply_to ?? env.REPLY_TO_EMAIL
    ↓
Resend API
```

### Tenant Resolution (bank_id)
- Uses existing `getCurrentBankId()` from `@/lib/tenant/getCurrentBankId`
- Clerk userId → `bank_memberships` table → `bank_id`
- Auto-selects if user has exactly 1 membership
- Throws if 0 or 2+ memberships (handled gracefully in routing)

### Safety: FROM Allowlist
**Env Var:** `ALLOWED_OUTBOUND_FROM_EMAILS` (comma-separated)
- Dev: Permissive (no env = allow all)
- Prod: Strict (only verified senders)
- Checked in `tenantRouting.ts` before returning config
- Prevents arbitrary FROM spoofing

## Environment Variables

### Existing (Already Set)
```bash
EMAIL_FROM="Underwriting <underwriting@buddytheunderwriter.com>"
OUTBOUND_FROM_EMAIL="Underwriting <underwriting@buddytheunderwriter.com>"
CONTACT_TO_EMAIL="sales@buddytheunderwriter.com"  # Added today
RESEND_API_KEY=re_...
```

### Optional (Production)
```bash
# Allowlist for verified senders (comma-separated)
ALLOWED_OUTBOUND_FROM_EMAILS="Underwriting <underwriting@buddytheunderwriter.com>,Sales <sales@buddytheunderwriter.com>"
```

## How To Use

### Dev (Env Fallback)
```bash
# Already works - uses EMAIL_FROM and CONTACT_TO_EMAIL
npm run dev
./smoke-test-email-routing.sh
```

### Production (Tenant Routing)
1. **Apply migration:**
   ```bash
   psql $DATABASE_URL -f supabase/migrations/20251227185822_tenant_email_routing.sql
   ```

2. **Set allowlist (prod only):**
   ```bash
   export ALLOWED_OUTBOUND_FROM_EMAILS="Underwriting <underwriting@buddytheunderwriter.com>"
   ```

3. **Configure per-tenant routing:**
   - Visit: `http://localhost:3000/admin/email-routing`
   - Set Contact TO, Outbound FROM, Reply-To mode
   - Save

4. **Test:**
   ```bash
   curl -X POST http://localhost:3000/api/contact \
     -H "content-type: application/json" \
     -d '{"name":"Test","email":"test@example.com","message":"Hello"}'
   # Should use tenant config, not env
   ```

## API Reference

### GET /api/admin/tenant/email-routing
**Auth:** Super admin only  
**Returns:**
```json
{
  "ok": true,
  "routing": {
    "contact_to_email": "sales@buddytheunderwriter.com",
    "outbound_from_email": "Underwriting <underwriting@buddytheunderwriter.com>",
    "reply_to_mode": "submitter",
    "configured_reply_to_email": null,
    "is_enabled": true,
    "updated_at": "2025-12-27T19:00:00Z"
  }
}
```

### POST /api/admin/tenant/email-routing
**Auth:** Super admin only  
**Body:**
```json
{
  "contact_to_email": "sales@buddytheunderwriter.com",
  "outbound_from_email": "Underwriting <underwriting@buddytheunderwriter.com>",
  "reply_to_mode": "submitter",
  "configured_reply_to_email": null,
  "is_enabled": true
}
```
**Returns:** `{"ok": true}`

### POST /api/contact
**Public endpoint**  
**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "company": "Acme Bank",
  "subject": "Interested in Buddy",
  "message": "Tell me more..."
}
```
**Routing:**
- If tenant config exists & enabled: uses tenant FROM/TO
- Else: uses env EMAIL_FROM / CONTACT_TO_EMAIL
- Reply-To: submitter email > tenant configured > env fallback

## Files Changed/Created

### Created (6 files)
1. `supabase/migrations/20251227185822_tenant_email_routing.sql` - DB schema
2. `src/lib/email/tenantRouting.ts` - Tenant routing accessor
3. `src/app/api/admin/tenant/email-routing/route.ts` - Admin API
4. `src/app/(app)/admin/email-routing/page.tsx` - Admin UI
5. `smoke-test-email-routing.sh` - Smoke tests
6. `TENANT_EMAIL_ROUTING_COMPLETE.md` - This doc

### Modified (2 files)
1. `src/app/api/contact/route.ts` - DB-first routing with env fallback
2. `src/lib/email/env.ts` - Renamed function, added docs

### Ledger
All work tracked in: `docs/buddy-ledger.md` (single canonical table)

## Migration Path

### Current State (Dec 27, 2025)
- ✅ Dev works with env fallback (EMAIL_FROM + CONTACT_TO_EMAIL)
- ✅ Prod ready with tenant routing system
- ✅ Build passes, no TypeScript errors
- ✅ Admin UI for configuration

### Next Steps
1. **Apply migration to prod DB**
2. **Set ALLOWED_OUTBOUND_FROM_EMAILS in prod env**
3. **Configure tenant routing for first bank** (via admin UI)
4. **Verify Resend verified senders match allowlist**
5. **Monitor contact form submissions**

### Future Enhancements
- [ ] Email audit log (track all sent emails)
- [ ] Multiple recipients per tenant (CC/BCC)
- [ ] Template system for contact emails
- [ ] Rate limiting per tenant
- [ ] Bounce handling & feedback loop

## Troubleshooting

### "Contact email routing is not configured"
- Check: `EMAIL_FROM` and `CONTACT_TO_EMAIL` in `.env.local`
- Or: Configure tenant routing via admin UI

### "FROM not in allowlist"
- Set: `ALLOWED_OUTBOUND_FROM_EMAILS` env var (prod)
- Or: Remove allowlist check (dev only)

### "Forbidden" on admin API
- Check: Your Clerk user ID is in `ADMIN_CLERK_USER_IDS`
- File: `.env.local` → `ADMIN_CLERK_USER_IDS=user_xxx`

### Build errors
```bash
npm run build
# Check for TypeScript errors in:
# - src/lib/email/tenantRouting.ts
# - src/app/api/contact/route.ts
# - src/app/api/admin/tenant/email-routing/route.ts
```

## Success Criteria ✅

All met:
- [x] `/api/contact` works with EMAIL_FROM / OUTBOUND_FROM_EMAIL (existing keys)
- [x] No new FROM keys introduced (reused EMAIL_FROM)
- [x] Tenant routing table created with bank_id
- [x] Admin API for CRUD operations
- [x] Admin UI page for configuration
- [x] FROM allowlist safety guard
- [x] DB-first routing with env fallback
- [x] Reply-to supports submitter email
- [x] Build passes without errors
- [x] All work in single canonical ledger

---

**Shipped by:** GitHub Copilot  
**Date:** December 27, 2025  
**Ledger:** `docs/buddy-ledger.md`
