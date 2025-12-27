# Email Env Keys - Discovery & Wiring Complete

**Date**: December 27, 2025  
**Task**: Discover existing Resend env keys + wire `/api/contact` (no new env vars)

---

## 🔍 Discovery Results

### Existing Email Env Keys Found

| Key | Usage Count | Files | Purpose |
|-----|-------------|-------|---------|
| `EMAIL_FROM` | 6+ | reminders, notifications, outbound, messages | **Primary canonical key** |
| `OUTBOUND_FROM_EMAIL` | 1 | outbound/missing-docs | Legacy outbound system |
| `CONTACT_FROM_EMAIL` | 1 | api/contact (growth) | Growth features (new) |
| `CONTACT_TO_EMAIL` | 1 | api/contact (growth) | Growth features (new) |
| `RESEND_API_KEY` | 8+ | All email sending | Resend API authentication |

### Key Selection Strategy

**FROM address** (in priority order):
1. `EMAIL_FROM` ← **Primary (most widely used)**
2. `CONTACT_FROM_EMAIL` ← Fallback (growth features)
3. `OUTBOUND_FROM_EMAIL` ← Fallback (legacy)

**TO address**:
1. `CONTACT_TO_EMAIL` ← Contact form destination

**REPLY_TO address**:
- None found in codebase
- Uses submitter's email as replyTo (best UX)

---

## 📁 Files Created

### 1. `src/lib/email/env.ts`
Environment variable resolver that:
- Discovers which FROM key is actually set (EMAIL_FROM → CONTACT_FROM_EMAIL → OUTBOUND_FROM_EMAIL)
- Discovers which TO key is set (CONTACT_TO_EMAIL)
- Returns `{ from, to, missing }` with actual values + which key was used
- **Zero new env vars** - only uses existing keys

```typescript
import { resolveContactEmailRouting } from "@/lib/email/env";

const { from, to, missing } = resolveContactEmailRouting();
// from.key = "EMAIL_FROM" (or whatever is actually set)
// from.value = "buddy@yourdomain.com"
// missing.from = false (if found)
```

### 2. `test-contact-api.sh`
Curl-based test script for `/api/contact` endpoint

---

## 🔧 Files Modified

### `src/app/api/contact/route.ts`

**Before** (hardcoded keys):
```typescript
const FROM = process.env.CONTACT_FROM_EMAIL;
const TO = process.env.CONTACT_TO_EMAIL;

if (!RESEND_API_KEY || !FROM || !TO) {
  return error("Resend not configured");
}
```

**After** (resolver-based):
```typescript
const { from, to, missing } = resolveContactEmailRouting();

if (missing.from || missing.to) {
  return error("Email routing not configured", { 
    from_key: from?.key,
    to_key: to?.key,
    missing 
  });
}

await resend.emails.send({
  from: from.value,  // Uses EMAIL_FROM (or fallback)
  to: [to.value],    // Uses CONTACT_TO_EMAIL
  replyTo: email,    // Submitter's email
});
```

**Benefits**:
- Logs which key it's actually using (`from_key`, `to_key`)
- Falls back gracefully (EMAIL_FROM → CONTACT_FROM_EMAIL → OUTBOUND_FROM_EMAIL)
- Clear error messages showing what's missing
- No need to set all 3 FROM keys - just set one

---

## ✅ Verification

### Build Test
```bash
npm run build
# ✅ Compiles with no errors
```

### API Test (when dev server running)
```bash
# Start dev
npm run dev

# In another terminal
./test-contact-api.sh
```

**Expected behavior**:

**Scenario 1: EMAIL_FROM + CONTACT_TO_EMAIL set**
```json
{
  "ok": true,
  "id": "abc123"
}
```

**Scenario 2: Missing EMAIL_FROM**
```json
{
  "ok": false,
  "error": "Email routing not configured. Need EMAIL_FROM and CONTACT_TO_EMAIL env vars.",
  "debug": {
    "from_key": null,
    "to_key": "CONTACT_TO_EMAIL",
    "missing": {
      "from": true,
      "to": false
    }
  }
}
```

**Scenario 3: Missing RESEND_API_KEY**
```json
{
  "ok": false,
  "error": "RESEND_API_KEY is not configured"
}
```

---

## 📊 Ledger

See [docs/buddy-ledger.md](docs/buddy-ledger.md) for step-by-step log.

| Step | Action | Result |
|------|--------|--------|
| 1 | Discover env keys | Found: EMAIL_FROM (primary), OUTBOUND_FROM_EMAIL (legacy), CONTACT_FROM_EMAIL/TO (growth) |
| 2 | Create resolver | `src/lib/email/env.ts` with priority fallback |
| 3 | Wire API route | Updated `/api/contact` to use resolver |
| 4 | Fix TS error | Added type annotation |
| 5 | Build test | ✅ Compiles clean |

---

## 🎯 What Changed vs Original

### Original Growth Features Implementation
Used hardcoded keys:
```typescript
const FROM = process.env.CONTACT_FROM_EMAIL;
const TO = process.env.CONTACT_TO_EMAIL;
```

### New Resolver Implementation
Uses existing keys with fallback:
```typescript
const { from, to } = resolveContactEmailRouting();
// Tries EMAIL_FROM first (already used in 6+ files)
// Falls back to CONTACT_FROM_EMAIL if EMAIL_FROM not set
```

**Why this is better**:
- ✅ Reuses existing `EMAIL_FROM` key (no duplication)
- ✅ Works with existing env setup (no new vars needed)
- ✅ Falls back gracefully (prioritizes most-used key)
- ✅ Logs which key was used (better debugging)
- ✅ Single source of truth for email routing

---

## 🚀 Next Steps

### Option 1: Use EMAIL_FROM (Recommended)

**If you already have `EMAIL_FROM` set**:
- ✅ `/api/contact` will use it automatically
- ✅ No new env vars needed
- ✅ Consistent with rest of codebase

### Option 2: Set CONTACT_TO_EMAIL

**Add to hosting provider env**:
```bash
CONTACT_TO_EMAIL=sales@yourdomain.com
```

### Option 3: Test Locally

**Add to `.env.local`** (for testing only):
```bash
EMAIL_FROM=buddy@localhost
CONTACT_TO_EMAIL=test@localhost
```

Then run:
```bash
npm run dev
./test-contact-api.sh
```

---

## 📝 Summary

**What we did**:
1. ✅ Discovered existing env keys (EMAIL_FROM, OUTBOUND_FROM_EMAIL, CONTACT_FROM_EMAIL/TO)
2. ✅ Created resolver that prioritizes EMAIL_FROM (most-used key)
3. ✅ Updated `/api/contact` to use resolver instead of hardcoded keys
4. ✅ Zero new env vars introduced (reuses existing keys)
5. ✅ Better error messages (shows which key is missing)
6. ✅ TypeScript compiles clean

**What we didn't do**:
- ❌ Did NOT touch `.env.local`
- ❌ Did NOT introduce new env vars
- ❌ Did NOT hardcode email addresses
- ❌ Did NOT break existing email sending

**Result**: Contact form now uses the same env keys as the rest of your app, with intelligent fallback.

---

**Key names for your records**:

```typescript
// FROM candidates (in priority order)
EMAIL_FROM           // Primary - used in 6+ files
CONTACT_FROM_EMAIL   // Fallback - growth features
OUTBOUND_FROM_EMAIL  // Fallback - legacy

// TO
CONTACT_TO_EMAIL     // Contact form destination

// API key
RESEND_API_KEY       // Already exists
```
