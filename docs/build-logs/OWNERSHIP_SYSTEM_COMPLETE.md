# Ownership System + 20% Rule — COMPLETE ✅

Full ownership tracking with automatic 20% threshold enforcement, separate owner portals, and email outreach queue.

---

## What You Got

**20% Rule Enforcement:**
- Any owner ≥ 20% ownership → system sets `requires_personal_package = true`
- Auto-generates owner-specific checklist: PFS + 3 years personal tax + guaranty
- Creates separate portal token for each owner
- Banker can create portal link + queue email invite

**Missing Ownership Discovery:**
- Inference engine attempts to extract ownership from uploaded docs (operating agreement, K-1s, cap table)
- Returns suggestions to banker with confidence scores
- Borrower-facing Buddy can prompt for ownership if unknown

**Owner Portal:**
- Separate from main borrower portal
- Token-based auth (no shared session)
- Owner sees ONLY their personal checklist
- No access to deal financials, other owners, or underwriting data
- Progress tracking + celebrations

**Email Outreach Queue:**
- Server-side queue (`deal_owner_outreach_queue`)
- Tick route processes pending emails
- Supports: invite, reminder, update
- No client-side email sending (canonical safe)

---

## Files Created

### 1. Migration
- `supabase/migrations/20251220_deal_ownership_and_owner_portals.sql`
  - **deal_owners** — canonical ownership source, 20% threshold flag
  - **deal_owner_portals** — separate portal tokens per owner
  - **deal_owner_checklist_items** — owner-specific items (PFS, personal tax, guaranty)
  - **deal_owner_checklist_state** — per-owner progress tracking
  - **deal_owner_outreach_queue** — email queue (server processes)
  - All RLS deny-all (server-only access)

### 2. Server Libraries
- `src/lib/ownership/rules.ts`
  - `SBA_PERSONAL_PACKAGE_THRESHOLD = 20`
  - `requiresPersonalPackage()` — boolean check
  - `ownerChecklistTemplate()` — borrower-friendly labels (no SBA jargon)

- `src/lib/ownership/server.ts`
  - `upsertOwners()` — batch create owners with ownership % + source
  - `recomputeOwnerRequirements()` — recalc 20% rule after ownership update
  - `ensureOwnerChecklist()` — idempotent checklist creation (PFS + 3yr tax + guaranty)
  - `createOrRefreshOwnerPortal()` — generates token, 14-day expiry

- `src/lib/ownership/infer.ts`
  - `inferOwnershipFromDocs()` — pattern match for "Name - 25%" in OCR text
  - Returns: `{ fullName, percent, confidence }[]`
  - Banker-only visibility (never shown as fact to borrower)

### 3. Banker API
- `src/app/api/banker/deals/[dealId]/owners/route.ts`
  - **GET** — fetch all owners + inferred ownership suggestions
  - **POST** actions:
    - `set_owner` — update ownership %, email, recalc 20% rule
    - `create_owner_portal` — generate portal token, ensure checklist
  - Returns: `{ ownerPortalUrl, expiresAt }`

### 4. Owner Portal Auth
- `src/lib/portal/ownerAuth.ts`
  - `requireValidOwnerPortal()` — validates token from query/header
  - Checks: not revoked, not expired
  - Returns: `{ token, dealId, ownerId, portal }`

### 5. Owner Portal API
- `src/app/api/portal/owner/guided/route.ts`
  - **GET** — owner-specific guided snapshot
  - Returns: owner info, progress, checklist (merged items + state)
  - Owner sees ONLY their checklist (no deal data, no other owners)

### 6. Owner Portal Page
- `src/app/portal/owner/[token]/page.tsx`
  - Token-based auth (separate from borrower)
  - Progress bar + checklist view
  - Celebrations (toast + confetti on progress)
  - Upload placeholder (wire to your existing upload with owner context)
  - Polls every 9s for live updates

### 7. Email Outreach Tick Route
- `src/app/api/admin/outreach/owners/tick/route.ts`
  - Processes queued emails (status=queued, scheduled_at ≤ now)
  - Updates status: sent/failed
  - Logs last_error on failure
  - TODO: wire to your email provider (Resend/Postmark/SendGrid/SES)

---

## 20% Rule Flow

### Banker Discovers Owner
1. Banker enters owner: "Sarah Johnson, 25%"
2. System checks: 25 ≥ 20 → `requires_personal_package = true`
3. Banker clicks "Create Owner Portal"
4. System:
   - Ensures checklist exists (PFS + 3yr tax + guaranty)
   - Generates portal token
   - Returns URL: `/portal/owner/abc123...`
   - Banker can queue email invite

### Owner Portal Experience
1. Sarah opens link
2. Sees: "Hi Sarah 👋 — This is a short personal checklist"
3. Progress: 0 / 5 complete
4. Checklist:
   - Personal Financial Statement
   - Personal tax return (most recent year)
   - Personal tax return (prior year)
   - Personal tax return (2 years ago)
   - Personal guaranty
5. Upload dropzone (wire to your existing upload)
6. As items arrive → checklist auto-highlights → progress bar updates → celebration toast

### Banker Side
- Sees owner card: "Sarah Johnson - 25% - requires personal package ✅"
- Timeline events: "Owner uploaded Personal Financial Statement"
- Owner checklist state visible in banker UI
- Can revoke portal if needed

---

## Missing Ownership Discovery

### Inference (Lane B)
```ts
const inferred = await inferOwnershipFromDocs(dealId);
// Returns: [{ fullName: "John Smith", percent: 30, confidence: 0.55 }, ...]
```

Banker sees:
- **Confirmed owners:** 2 (entered manually)
- **Possible owners found in docs:** 1 suggestion
  - John Smith - 30% (confidence: 55%)
  - Action: "Confirm & Create Portal"

### Ask (Lane A — preferred)
Borrower-facing Buddy says:
> "To make sure we request the right personal items, can you list the owners and approximate % each owns?"

If borrower doesn't know:
> "No problem — can you upload any ownership document (operating agreement, cap table, or K-1s)? We can work from that."

System infers → banker confirms → creates owner portals

---

## Email Outreach Queue

### Queue an invite:
```ts
await sb.from("deal_owner_outreach_queue").insert({
  deal_id: dealId,
  owner_id: ownerId,
  kind: "invite",
  to_email: "sarah@example.com",
  subject: "Personal documents needed for your loan application",
  body: `Hi Sarah,\n\nWe need a few personal documents from you...\n\nPortal: ${portalUrl}`,
  scheduled_at: new Date().toISOString(),
});
```

### Process queue:
```bash
curl -X POST https://yourdomain.com/api/admin/outreach/owners/tick
# Returns: { ok: true, processed: 5, sent: 4, failed: 1 }
```

Run this on a cron (every 5 min) or manual trigger.

---

## Canonical Compliance ✅

**What Owner Portal Shows:**
- Owner's full name
- Owner's checklist (5 items: PFS + 3yr tax + guaranty)
- Progress bar
- Upload dropzone

**What Owner Portal Does NOT Show:**
- Deal financials
- Other owners
- Borrower data
- Underwriting status/scores
- Credit data
- Internal banker notes
- Full deal checklist

**Security:**
- All ownership tables: RLS deny-all
- Owner portal auth: token-based server validation
- No client-side data access
- Emails sent only by server tick route
- Owner can only see their own checklist state

**20% Rule:**
- Automatically computed on ownership insert/update
- Checklist auto-created when `requires_personal_package = true`
- Portal link can be created on-demand (not auto-sent)
- Email invite is queued (not auto-sent)

---

## TODO: Storage Integration

Owner upload endpoint needs to:
1. Accept `x-owner-token` header
2. Validate via `requireValidOwnerPortal()`
3. Upload file to storage
4. Record owner receipt (similar to borrower receipt)
5. Auto-match checklist via `match_hints`

If you say **GO Owner Receipt Auto-Match**, I'll create:
- `recordOwnerReceipt()` library
- Owner upload API route
- Checklist auto-match logic

---

## Testing

### 1. Run Migration
```bash
psql $DATABASE_URL -f supabase/migrations/20251220_deal_ownership_and_owner_portals.sql
```

### 2. Create Owner (Banker API)
```bash
curl -X POST https://yourdomain.com/api/banker/deals/DEAL_ID/owners \
  -H "x-user-id: BANKER_USER_ID" \
  -H "content-type: application/json" \
  -d '{
    "action": "set_owner",
    "ownerId": "NEW_OWNER_ID",
    "fullName": "Sarah Johnson",
    "email": "sarah@example.com",
    "ownershipPercent": 25
  }'
```

### 3. Create Owner Portal
```bash
curl -X POST https://yourdomain.com/api/banker/deals/DEAL_ID/owners \
  -H "x-user-id: BANKER_USER_ID" \
  -H "content-type: application/json" \
  -d '{
    "action": "create_owner_portal",
    "ownerId": "OWNER_ID"
  }'
# Returns: { ok: true, ownerPortalUrl: "/portal/owner/abc123...", expiresAt: "..." }
```

### 4. Open Owner Portal
- Visit: `https://yourdomain.com/portal/owner/abc123...`
- See: "Hi Sarah 👋" + checklist
- Upload placeholder visible

### 5. Process Email Queue
```bash
curl -X POST https://yourdomain.com/api/admin/outreach/owners/tick
```

---

## Next "Holy Sh*t" Option

**GO Ownership Wizard** — borrower-facing 60-second wizard:
1. "How many owners?" (slider 1-10)
2. For each: Name, Email, Phone (optional)
3. Ownership % (slider with "approx ok" tooltip)
4. If unknown: "Upload operating agreement or K-1s" dropzone
5. Submit → system creates owners → triggers banker review

This eliminates missing ownership anxiety early in the process.

---

**Status:** READY TO TEST

The system now enforces the 20% rule, creates separate owner portals, and queues email outreach — all canonically safe with RLS deny-all and server-only access.
