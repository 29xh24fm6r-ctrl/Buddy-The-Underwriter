# Deal Participants System

## 🎯 Overview

Role-based deal ownership using normalized `deal_participants` table instead of adding columns to various tables. More flexible, auditable, and supports multiple roles per user across different deals.

## 📋 Benefits Over Column Approach

**Old approach (borrower_clerk_user_id column):**
- ❌ Denormalized (one column per role type)
- ❌ Hard to query "all deals for user X"
- ❌ Can't track role changes over time
- ❌ Doesn't support multiple roles on same deal

**New approach (deal_participants table):**
- ✅ Normalized (one table for all participants)
- ✅ Easy to query "all deals where user is borrower"
- ✅ Tracks role changes via updated_at
- ✅ Supports multiple roles (user can be borrower + underwriter)
- ✅ `is_active` flag for soft deactivation
- ✅ Metadata column for future extensions

## 🗄️ Schema

```sql
CREATE TABLE deal_participants (
  id UUID PRIMARY KEY,
  deal_id UUID REFERENCES applications(id),
  clerk_user_id TEXT NOT NULL,
  role TEXT CHECK (role IN ('borrower', 'underwriter', 'bank_admin')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  
  UNIQUE(deal_id, clerk_user_id, role)
);
```

## 🔄 Auto-Registration Pattern

**Shared helpers in `src/lib/deals/participants.ts`:**

```typescript
import { registerBorrowerParticipant, touchParticipant } from "@/lib/deals/participants";

// In your upload endpoint:
export async function POST(req: Request, ctx: { params: { dealId: string } }) {
  const { dealId } = await ctx.params;
  const { userId } = await auth();
  
  // ... existing upload logic ...
  
  // Auto-register borrower (impossible to forget - centralized helper)
  await registerBorrowerParticipant(dealId, userId);
  
  // Touch participant to update activity timestamp
  await touchParticipant(dealId, userId, "borrower");
  
  return NextResponse.json({ ok: true });
}
```

**Why this works:**
- Centralized helper in `src/lib/deals/participants.ts`
- Impossible to forget (single import)
- Safe to call multiple times (upsert pattern)
- Activity tracking built-in
- No duplicate logic across routes

## 🔐 API-Level Access Control

**Enforce borrower access at API boundary:**

```typescript
import { requireBorrowerOnDeal } from "@/lib/deals/participants";

export async function GET(req: Request, ctx: { params: { dealId: string } }) {
  const { dealId } = await ctx.params;
  
  // API-level enforcement: throws if borrower not participant
  await requireBorrowerOnDeal(dealId);
  
  // Now safe to query deal data
  const conditions = await fetchConditions(dealId);
  return NextResponse.json({ ok: true, conditions });
}
```

**Available enforcement helpers:**
- `requireBorrowerOnDeal(dealId)` - Throws if not borrower on deal
- `requireUnderwriterOnDeal(dealId)` - Throws if not underwriter on deal
- `getUserRoleOnDeal(dealId, userId)` - Returns role or null

**Error handling:**
```typescript
try {
  await requireBorrowerOnDeal(dealId);
  // ... fetch data ...
} catch (err) {
  if (err.message === "unauthorized") return 401;
  if (err.message === "forbidden") return 403;
  return 500;
}
```

**Why this is bulletproof:**
- UI gating is nice, **API gating is law**
- Can't bypass with Postman/curl
- Centralized enforcement (no duplicate checks)
- Throws on violation (fail-closed)


## 📡 API Endpoints

### 1. Get Active Deal (Borrower)
```typescript
GET /api/borrower/active-deal

// Returns most recent deal where user is active borrower
// Response: { ok: true, dealId: "uuid" }
```

**Implementation:**
```typescript
const { data } = await supabase
  .from("deal_participants")
  .select("deal_id, updated_at")
  .eq("clerk_user_id", userId)
  .eq("role", "borrower")
  .eq("is_active", true)
  .order("updated_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```

### 2. Assign Underwriter (Admin)
```typescript
POST /api/admin/deals/[dealId]/assign-underwriter
Body: { clerk_user_id: "user_xyz" }

// Assigns underwriter to deal
// Response: { ok: true, participant: {...} }
```

**Implementation:**
```typescript
await supabase.from("deal_participants").upsert({
  deal_id: dealId,
  clerk_user_id,
  role: "underwriter",
  is_active: true,
  updated_at: new Date().toISOString(),
}, { onConflict: "deal_id,clerk_user_id,role" });
```

### 3. Verify Borrower Ownership
```typescript
// In role-aware endpoints:
if (role === "borrower") {
  const { data: participant } = await supabase
    .from("deal_participants")
    .select("clerk_user_id, is_active")
    .eq("deal_id", dealId)
    .eq("clerk_user_id", userId)
    .eq("role", "borrower")
    .eq("is_active", true)
    .maybeSingle();
    
  if (!participant) {
    return 403; // Forbidden
  }
}
```

## 🔐 Security Patterns

### Role-Based Deal Access
```typescript
// Borrowers can only see their own deals
// Underwriters can see assigned deals
// Admins can see all deals

const { userId, role } = await requireRole(["borrower", "underwriter", "super_admin"]);

if (role === "borrower") {
  // Verify via deal_participants
  const canAccess = await verifyBorrowerAccess(dealId, userId);
  if (!canAccess) return 403;
}
```

### Activity Tracking
```typescript
// Update `updated_at` on participant row to track activity
await supabase
  .from("deal_participants")
  .update({ updated_at: new Date().toISOString() })
  .eq("deal_id", dealId)
  .eq("clerk_user_id", userId);
```

## 🎯 Common Queries

**All deals for a borrower:**
```sql
SELECT deal_id 
FROM deal_participants 
WHERE clerk_user_id = 'user_xyz' 
  AND role = 'borrower' 
  AND is_active = true;
```

**All underwriters on a deal:**
```sql
SELECT clerk_user_id 
FROM deal_participants 
WHERE deal_id = 'deal_abc' 
  AND role = 'underwriter' 
  AND is_active = true;
```

**Recent borrower activity:**
```sql
SELECT deal_id, updated_at 
FROM deal_participants 
WHERE clerk_user_id = 'user_xyz' 
  AND role = 'borrower' 
ORDER BY updated_at DESC 
LIMIT 10;
```

## 🚀 Migration Guide

### From borrower_clerk_user_id Column

**Before:**
```sql
-- applications table
ALTER TABLE applications ADD COLUMN borrower_clerk_user_id TEXT;
```

**After:**
```sql
-- Backfill participants from existing data
INSERT INTO deal_participants (deal_id, clerk_user_id, role, is_active)
SELECT id, borrower_clerk_user_id, 'borrower', true
FROM applications
WHERE borrower_clerk_user_id IS NOT NULL;

-- Optional: Drop old column after verification
-- ALTER TABLE applications DROP COLUMN borrower_clerk_user_id;
```

### Update Existing Code

**Before:**
```typescript
const { data } = await supabase
  .from("applications")
  .select("*")
  .eq("borrower_clerk_user_id", userId);
```

**After:**
```typescript
const { data: participants } = await supabase
  .from("deal_participants")
  .select("deal_id")
  .eq("clerk_user_id", userId)
  .eq("role", "borrower");

const dealIds = participants.map(p => p.deal_id);
```

## 🔮 Future Enhancements

### Multi-Role Support
```typescript
// User can be both borrower and underwriter on different deals
await registerParticipant(dealId, userId, "borrower");
await registerParticipant(otherDealId, userId, "underwriter");
```

### Team Assignments
```typescript
// Assign entire bank team to a deal
const teamMembers = ["user1", "user2", "user3"];
for (const userId of teamMembers) {
  await registerParticipant(dealId, userId, "bank_admin");
}
```

### Delegation Tracking
```typescript
// Track who delegated whom
await supabase.from("deal_participants").insert({
  deal_id: dealId,
  clerk_user_id: newUserId,
  role: "underwriter",
  metadata: {
    delegated_by: currentUserId,
    delegated_at: new Date().toISOString(),
  },
});
```

### Historical Audit Trail
```typescript
// Don't delete, just mark inactive
await supabase
  .from("deal_participants")
  .update({ 
    is_active: false,
    metadata: supabase.raw(`metadata || '{"deactivated_at": "${new Date().toISOString()}"}'::jsonb`)
  })
  .eq("id", participantId);
```

## 📊 Usage Examples

### Borrower Dashboard
```typescript
// Get all active deals for borrower
const { data: deals } = await supabase
  .from("deal_participants")
  .select(`
    deal_id,
    updated_at,
    applications!inner(id, name, status)
  `)
  .eq("clerk_user_id", userId)
  .eq("role", "borrower")
  .eq("is_active", true)
  .order("updated_at", { ascending: false });
```

### Underwriter Workload
```typescript
// Count active deals per underwriter
const { data } = await supabase
  .from("deal_participants")
  .select("clerk_user_id")
  .eq("role", "underwriter")
  .eq("is_active", true);

const workload = data.reduce((acc, p) => {
  acc[p.clerk_user_id] = (acc[p.clerk_user_id] || 0) + 1;
  return acc;
}, {});
```

### Deal Reassignment
```typescript
// Move deal from one underwriter to another
await supabase.from("deal_participants").update({ is_active: false })
  .eq("deal_id", dealId)
  .eq("role", "underwriter");

await supabase.from("deal_participants").insert({
  deal_id: dealId,
  clerk_user_id: newUnderwriterId,
  role: "underwriter",
  is_active: true,
});
```

---

This normalized approach is **production-grade** and scales with your loan volume while maintaining clean audit trails and flexible role management.
