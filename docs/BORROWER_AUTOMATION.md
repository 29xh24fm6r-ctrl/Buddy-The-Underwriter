# Borrower Automation System

## 🎯 Overview

Complete self-healing borrower experience that automatically:
- Detects stalled conditions (no activity for N days)
- Generates smart nudge messages with AI explanations
- Enforces throttles (max 2 nudges per 7 days)
- Requires underwriter approval before sending
- Updates borrower's real-time checklist

## 📁 Files Created

### Core Infrastructure
- **`src/app/borrower/page.tsx`** - Role-gated borrower portal homepage
- **`src/components/deals/BorrowerConditionsCard.tsx`** - Borrower's loan checklist with progress tracking
- **`src/app/api/borrower/active-deal/route.ts`** - Returns borrower's most recent deal
- **`src/app/api/deals/[dealId]/conditions/route.ts`** - Role-aware conditions API

### Automation Engine
- **`src/lib/borrowerAutomation/stallRules.ts`** - Deterministic stall detection logic
  - No activity for 5+ days → stalled
  - No condition change for 7+ days → stalled
  - Throttle: max 2 sends per 7-day window

- **`src/app/api/automation/borrower-nudges/run/route.ts`** - Automation runner
  - Detects stalled conditions
  - Generates DRAFT messages
  - Checks throttles
  - AI-powered explanations

### Approval Workflow
- **`src/components/deals/ConditionMessagingCard.tsx`** - Underwriter approval UI
- **`src/app/api/deals/[dealId]/messages/route.ts`** - List draft messages
- **`src/app/api/deals/[dealId]/messages/[messageId]/send/route.ts`** - Approve & send

### Auto-Trigger Wiring
- **`src/lib/borrowerAutomation/triggers.ts`** - Self-healing hooks
  - `recordBorrowerActivity(dealId)` - Update activity timestamp
  - `triggerConditionRecompute(dealId)` - Recompute conditions
  - `clearSatisfiedCondition(conditionId)` - Mark as satisfied

### Database Migration
- **`supabase/migrations/20251218_borrower_ownership.sql`** - Add `borrower_clerk_user_id` to applications

### Demo Script
- **`scripts/demo-borrower-automation.mjs`** - 60-second end-to-end demo

## 🔄 How It Works

### 1. Borrower Portal (`/borrower`)
```typescript
// Role-gated: only borrowers + admins
await requireRole(["borrower", "super_admin"]);

// Shows:
// - Completion % (satisfied / total conditions)
// - Outstanding conditions grouped by severity
// - Each condition: AI explanation + upload CTA
// - Completed conditions (collapsed)
```

### 2. Stall Detection
```typescript
computeStall({
  lastBorrowerActivityAt: "2025-12-10T10:00:00Z",
  lastEvaluatedAt: "2025-12-05T10:00:00Z",
  now: new Date("2025-12-18T10:00:00Z")
})

// Returns:
// { stalled: true, reason: "no_recent_borrower_activity" }
```

### 3. Automation Runner
```bash
POST /api/automation/borrower-nudges/run
Body: { deal_id: "uuid" }

# Super-admin only (phase 1)
# Later: scheduled cron job
```

**Flow:**
1. Load outstanding conditions for deal
2. Find last borrower activity (latest attachment)
3. Apply stall rules to each condition
4. Check throttles (max 2 per 7 days)
5. Generate DRAFT messages with AI explanations
6. Return count of drafted messages

### 4. Underwriter Approval
```tsx
<ConditionMessagingCard dealId={dealId} />

// Shows draft messages with:
// - Subject + body (AI-generated)
// - Priority (HIGH for REQUIRED conditions)
// - Stall reason metadata
// - "Approve & Send" button
// - "Delete" button
```

**On Approve:**
- Message status: DRAFT → SENT
- Update throttle record (send_count++, last_sent_at)
- TODO: Actually deliver (email/portal notification)

### 5. Self-Healing Loop

**After Upload:**
```typescript
import { recordBorrowerActivity } from "@/lib/borrowerAutomation/triggers";

// In your upload handler:
await recordBorrowerActivity(dealId);
```

**After Classification:**
```typescript
import { triggerConditionRecompute } from "@/lib/borrowerAutomation/triggers";

// In your classification handler:
await triggerConditionRecompute(dealId);
```

**After Condition Satisfied:**
```typescript
import { clearSatisfiedCondition } from "@/lib/borrowerAutomation/triggers";

// In your recompute logic:
await clearSatisfiedCondition(conditionId);
```

## 🚀 Quick Start

### 1. Run Migrations
```sql
-- Create deal_participants table (replaces borrower_clerk_user_id column approach)
-- See: supabase/migrations/20251218_deal_participants.sql
CREATE TABLE deal_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('borrower', 'underwriter', 'bank_admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  UNIQUE(deal_id, clerk_user_id, role)
);
```

### 2. Auto-Register Borrower on Upload
```typescript
// In your upload endpoint:
import { registerBorrowerParticipant } from "@/lib/borrowerAutomation/registerParticipant";

export async function POST(req: Request, ctx: { params: { dealId: string } }) {
  const { dealId } = await ctx.params;
  
  // ... existing upload logic ...
  
  // Self-healing: borrower uploads → auto-register as participant
  await registerBorrowerParticipant(dealId);
  
  return NextResponse.json({ ok: true });
}
```

### 3. Assign Underwriter (Admin)
```typescript
POST /api/admin/deals/[dealId]/assign-underwriter
Body: { clerk_user_id: "user_xyz" }

// Creates deal_participants row with role="underwriter"
```

### 3. Create Test Conditions
```sql
INSERT INTO conditions_to_close (
  application_id,
  title,
  status,
  severity,
  ai_explanation
) VALUES (
  'deal-uuid',
  'Personal Financial Statement Required',
  'outstanding',
  'REQUIRED',
  'Please upload your most recent Personal Financial Statement (PFS). This should include all assets, liabilities, and income sources.'
);
```

### 4. Run Demo
```bash
node scripts/demo-borrower-automation.mjs <dealId>
```

## 🔐 Security

### Role-Based Access
- **Borrower Portal:** `borrower` or `super_admin` roles only
- **Conditions API:** Borrowers can only see their own deals
- **Automation Runner:** `super_admin` only (phase 1)
- **Message Approval:** `underwriter`, `bank_admin`, or `super_admin`

### Ownership Verification
```typescript
// Borrowers must own the deal
if (role === "borrower") {
  const app = await supabase
    .from("applications")
    .select("borrower_clerk_user_id")
    .eq("id", dealId)
    .maybeSingle();
    
  if (app.borrower_clerk_user_id !== userId) {
    return 403; // Forbidden
  }
}
```

## 📊 UI Components

### BorrowerConditionsCard
```tsx
// Auto-fetches active deal + conditions
// Shows:
// - Progress bar (% completed)
// - Outstanding items (color-coded by severity)
// - Upload CTA per condition
// - Completed items (collapsed)

<BorrowerConditionsCard />
```

### ConditionMessagingCard
```tsx
// For underwriter approval
// Shows draft messages with approve/delete actions

<ConditionMessagingCard dealId={dealId} />
```

## 🎨 UX Features

### Progress Tracking
- Visual progress bar shows completion %
- Real-time updates as conditions are satisfied
- Color-coded severity (RED = REQUIRED, YELLOW = IMPORTANT, BLUE = FYI)

### Smart Nudges
- AI-generated explanations ("Upload your 2024 tax returns to satisfy IRS verification")
- Contextual next steps ("Click upload below to provide this document")
- Stall reason metadata (tracks why nudge was triggered)

### Throttle Protection
- Max 2 nudges per condition per 7-day window
- Prevents spam even with daily automation runs
- Tracked in `condition_message_throttles` table

## 🔮 Future Enhancements

### Phase 2: Scheduled Automation
```typescript
// Vercel Cron: /api/cron/borrower-nudges
export async function GET() {
  // Run automation for all deals with outstanding conditions
  const deals = await getDealsWithOutstandingConditions();
  for (const deal of deals) {
    await runBorrowerNudges(deal.id);
  }
}
```

### Phase 3: Email Delivery
```typescript
// In send route:
if (msg.channel === "EMAIL") {
  await sendEmail({
    to: borrower.email,
    subject: msg.subject,
    body: msg.body,
  });
}
```

### Phase 4: Portal Notifications
```typescript
// Real-time in-app notifications
await supabase.from("portal_notifications").insert({
  application_id: dealId,
  type: "CONDITION_REMINDER",
  message: msg.body,
  read: false,
});
```

## 🧪 Testing Checklist

- [ ] Borrower signs in at `/borrower`
- [ ] Sees active deal's checklist
- [ ] Outstanding conditions show AI explanations
- [ ] Upload CTA launches upload flow
- [ ] Run automation: `POST /api/automation/borrower-nudges/run`
- [ ] Underwriter sees draft messages
- [ ] Approve message → status changes to SENT
- [ ] Throttle prevents duplicate sends
- [ ] Upload document → activity timestamp updates
- [ ] Classification completes → conditions recompute
- [ ] Satisfied condition clears from borrower's list

## 📈 Metrics to Track

- **Condition Satisfaction Rate:** % of conditions auto-resolved
- **Borrower Response Time:** Time from nudge → upload
- **Nudge Effectiveness:** % of nudges that result in action
- **Stall Prevention:** Reduction in deals stuck > 7 days
- **Underwriter Approval Rate:** % of auto-generated nudges approved

## 🎓 Integration Points

### Wire into Upload Handler
```typescript
// src/app/api/deals/[dealId]/upload/route.ts
import { recordBorrowerActivity } from "@/lib/borrowerAutomation/triggers";

export async function POST(req, ctx) {
  const { dealId } = await ctx.params;
  
  // ... existing upload logic ...
  
  // Record activity for stall detection
  await recordBorrowerActivity(dealId);
}
```

### Wire into Classification
```typescript
// After classification completes
import { triggerConditionRecompute } from "@/lib/borrowerAutomation/triggers";

await triggerConditionRecompute(dealId);
```

### Wire into Recompute
```typescript
// When condition is satisfied
import { clearSatisfiedCondition } from "@/lib/borrowerAutomation/triggers";

if (conditionNowSatisfied) {
  await clearSatisfiedCondition(conditionId);
}
```

---

## 💡 Key Design Decisions

1. **Draft-First:** All automation creates DRAFT messages requiring approval
2. **Deterministic Rules:** Stall thresholds are configurable constants
3. **Throttle Protection:** Hard limits prevent spam
4. **Role-Aware:** Borrowers can only see their own deals
5. **Self-Healing:** Conditions auto-clear when satisfied
6. **Exam-Proof:** Every decision is traceable and auditable

This is **bank-grade borrower automation** that respects underwriter authority while eliminating manual nudge work.
