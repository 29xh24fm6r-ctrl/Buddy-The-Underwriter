# SBA 7(a) Eligibility Engine - Implementation Complete ✅

**Date**: December 18, 2025  
**Sprint**: Steps 3 + 4 - Deterministic SBA Eligibility + Borrower Wizard Routing

---

## 📋 What Was Built

A **deterministic, explainable SBA 7(a) eligibility engine** with automatic track routing (SBA vs Conventional) in the borrower portal.

### Core Principle
> **Deterministic where SBA is deterministic.** No LLM guessing on hard rules.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    BORROWER PORTAL                          │
│                   /borrower/[token]                         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ User fills wizard questions
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         WIZARD SCHEMA (borrowerWizard/schema.ts)            │
│   • Business Info (ALL)                                     │
│   • Loan Request (ALL)                                      │
│   • SBA Eligibility Check (ALL)                             │
│   • SBA 7(a) Details (SBA_7A track only)                    │
│   • Conventional Details (CONVENTIONAL track only)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ On each answer change
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│   ELIGIBILITY RECOMPUTE API                                 │
│   /api/borrower/[token]/eligibility/recompute               │
│   • Loads all answers from borrower_answers table           │
│   • Calls evaluateSba7aEligibility()                        │
│   • Persists result to borrower_applications                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Deterministic evaluation
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│      ELIGIBILITY ENGINE (sba7a/eligibility.ts)              │
│   • Hard blocker gates (7 gates)                            │
│   • Returns: ELIGIBLE | INELIGIBLE | UNKNOWN                │
│   • Returns: SBA_7A | CONVENTIONAL | UNKNOWN                │
│   • Explainable reasons (code + message + severity)         │
│   • Missing info list (key + question)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Result returned
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         UI UPDATES (Real-time Feedback)                     │
│   • Eligibility card shows status badge                     │
│     - ✅ Eligible (green)                                   │
│     - ⛔ Not eligible (red)                                 │
│     - 🟡 Need more info (yellow)                            │
│   • Wizard auto-routes to SBA vs Conventional track         │
│   • Shows reasons for determination                         │
│   • Shows "We still need" list                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Files Created

### 1. **Core Types** - `src/lib/sba7a/types.ts`
```typescript
export type SbaEligibilityStatus = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";

export type SbaEligibilityReason = {
  code: string;        // stable machine code (e.g., "FEDERAL_DEBT_DELINQUENT")
  message: string;     // borrower-friendly explanation
  severity: "BLOCK" | "INFO";
};

export type SbaEligibilityMissing = {
  key: string;         // answer key we need (e.g., "sba.intent.want_sba")
  question: string;    // what to ask next
};

export type SbaEligibilityResult = {
  status: SbaEligibilityStatus;
  candidate: boolean;               // SBA candidate based on intent
  best_program: "SBA_7A" | "CONVENTIONAL" | "UNKNOWN";
  reasons: SbaEligibilityReason[];
  missing: SbaEligibilityMissing[];
};
```

**Purpose**: Clean type definitions for eligibility engine results.

---

### 2. **Eligibility Engine** - `src/lib/sba7a/eligibility.ts`

**Hard Gates (v1):**
1. ✅ **Ineligible Business Category** - Gambling, lending, speculative, etc.
2. ✅ **Delinquent Federal Debt** - ABSOLUTE DISQUALIFIER until resolved
3. ✅ **US Citizenship/Eligibility** - All owners/guarantors must be US eligible
4. ✅ **Criminal History** - Flagged for additional review
5. ✅ **Prohibited Use of Proceeds** - No passive investment, speculation
6. ✅ **Size Standards** - Must not exceed SBA size limits
7. ✅ **Loan Amount** - Must be > $0

**Logic:**
```typescript
if (hasBlockers) {
  status = "INELIGIBLE";
  best_program = "CONVENTIONAL";
} else if (!candidate) {
  status = "UNKNOWN";
  best_program = "CONVENTIONAL";
} else if (!hasCriticalUnknown) {
  status = "ELIGIBLE";
  best_program = "SBA_7A";
} else {
  status = "UNKNOWN";
  best_program = candidate ? "UNKNOWN" : "CONVENTIONAL";
}
```

**Key Features:**
- Conservative: Returns UNKNOWN when missing critical facts
- Explainable: Every reason has code + message + severity
- Deterministic: Pure function, no randomness or LLM guessing
- Auditable: Full trace of what was checked and why

---

### 3. **Wizard Schema** - `src/lib/borrowerWizard/schema.ts`

**Sections:**

| Section ID | Title | Track | Questions |
|------------|-------|-------|-----------|
| `business` | Business Info | ALL | legal_name, ein, industry, naics |
| `loan` | Loan Request | ALL | amount, use_of_proceeds.primary |
| `sba_gate` | SBA Eligibility Check | ALL | 7 yes/no gates |
| `sba_track` | SBA 7(a) Details | SBA_7A | ownership, affiliates, experience |
| `conv_track` | Conventional Details | CONVENTIONAL | collateral, time_in_business |

**Question Types:**
- `text` - Free text input
- `number` - Numeric input (loan amount, years in business)
- `yesno` - Boolean select (Yes/No)
- `select` - Dropdown (use of proceeds options)

**Auto-Routing:**
Wizard only shows sections where `track === "ALL"` OR `track === current_eligibility_track`.

---

### 4. **Eligibility API** - `src/app/api/borrower/[token]/eligibility/recompute/route.ts`

**Endpoint:** `POST /api/borrower/[token]/eligibility/recompute`

**Flow:**
1. Load all answers from `borrower_answers` table
2. Call `evaluateSba7aEligibility({ answers })`
3. Persist result to `borrower_applications`:
   - `sba7a_candidate` (boolean)
   - `sba7a_eligible` (boolean | null)
   - `sba7a_ineligibility_reasons` (JSON array)
   - `loan_type` ("SBA_7A" | "TERM" | null)
4. Return result to client

**Response:**
```json
{
  "ok": true,
  "result": {
    "status": "ELIGIBLE",
    "candidate": true,
    "best_program": "SBA_7A",
    "reasons": [
      {
        "code": "INDUSTRY_CAPTURED",
        "message": "Industry details captured (NAICS: 541511).",
        "severity": "INFO"
      }
    ],
    "missing": []
  }
}
```

---

### 5. **Borrower Portal UI** - `src/app/borrower/[token]/page.tsx`

**Components:**
- `Header` - Shows application status + refresh button
- `EligibilityCard` - Real-time status badge, recommended track, reasons, missing info
- `Question` - Renders different input types (text, number, yesno, select)

**Key Features:**
- **Real-time eligibility**: Recomputes on every answer change
- **Auto-routing**: Wizard sections appear/disappear based on track
- **Visual feedback**: Color-coded badges (✅ green, ⛔ red, 🟡 yellow)
- **Transparency**: Shows reasons and missing info inline

**User Flow:**
1. Fill business info (name, EIN, industry)
2. Fill loan request (amount, use of proceeds)
3. Answer SBA eligibility questions (7 yes/no gates)
4. **Eligibility card updates in real-time**
5. If ELIGIBLE → SBA 7(a) Details section appears
6. If INELIGIBLE → Conventional Details section appears
7. Submit application

---

### 6. **Answer Upsert API** - `src/app/api/borrower/[token]/answer/upsert/route.ts`

**Endpoint:** `POST /api/borrower/[token]/answer/upsert`

**Body:**
```json
{
  "section": "sba",
  "question_key": "sba.intent.want_sba",
  "value": true
}
```

**Action:** Upserts to `borrower_answers` table with conflict resolution on `(application_id, question_key)`.

---

### 7. **Admin Create Endpoint** - `src/app/api/borrower/admin/create/route.ts`

**Endpoint:** `POST /api/borrower/admin/create`

**Body:**
```json
{
  "user_id": "YOUR_SUPABASE_USER_UUID",
  "deal_id": "optional_deal_id"
}
```

**Response:**
```json
{
  "ok": true,
  "application": { ... },
  "token": "abc123xyz789",
  "url": "http://localhost:3000/borrower/abc123xyz789"
}
```

---

### 8. **Helper Modules**

**`src/lib/borrower/token.ts`**
- `requireBorrowerToken(token)` - Validates token, returns application
- `generateToken()` - Creates random token

**`src/lib/supabase/admin.ts`**
- `supabaseAdmin()` - Returns Supabase client with service role key

---

## 🧪 Testing Instructions

### Step 1: Start Dev Server
```bash
npm run dev
```

### Step 2: Create Borrower Token
```bash
curl -s -X POST http://localhost:3000/api/borrower/admin/create \
  -H "Content-Type: application/json" \
  -d '{"user_id":"YOUR_SUPABASE_USER_UUID"}' | jq
```

**Response:**
```json
{
  "ok": true,
  "token": "abc123xyz789",
  "url": "http://localhost:3000/borrower/abc123xyz789"
}
```

### Step 3: Open Borrower Portal
```
http://localhost:3000/borrower/abc123xyz789
```

### Step 4: Validate Routing

**Scenario A: SBA Eligible Path**
1. Fill loan amount: `$500,000`
2. Use of proceeds: `Working capital`
3. SBA intent: `Yes`
4. Ineligible business: `No`
5. Federal debt delinquent: `No`
6. Owners US eligible: `Yes`
7. Criminal history: `No`
8. Proceeds prohibited: `No`
9. Exceeds size: `No`

**Expected:**
- Eligibility card shows: ✅ **Eligible**
- Recommended track: **SBA_7A**
- **SBA 7(a) Details** section appears
- Conventional Details section hidden

---

**Scenario B: SBA Ineligible Path (Federal Debt)**
1. Fill loan amount: `$500,000`
2. Use of proceeds: `Working capital`
3. SBA intent: `Yes`
4. Ineligible business: `No`
5. Federal debt delinquent: `Yes` ⛔

**Expected:**
- Eligibility card shows: ⛔ **Not eligible (based on current answers)**
- Recommended track: **CONVENTIONAL**
- Reasons include: "An owner indicated delinquent federal debt, which is typically a disqualifier until resolved."
- **Conventional Details** section appears
- SBA 7(a) Details section hidden

---

**Scenario C: Unknown (Missing Info)**
1. Fill loan amount: `$500,000`
2. Leave all SBA gate questions blank

**Expected:**
- Eligibility card shows: 🟡 **Need more info**
- Recommended track: **UNKNOWN**
- "We still need" list shows all 7 missing questions
- Only "ALL" track sections visible (no track-specific sections)

---

## 🎯 What This Unlocks

### Now (Immediate)
✅ **Deterministic SBA routing** - No more guessing if deal is SBA-eligible  
✅ **Real-time feedback** - Borrower sees eligibility before submitting  
✅ **Explainable decisions** - Every "yes/no" has a reason with code + message  
✅ **Audit trail** - Eligibility result persisted to database with full reasons  

### Next (Step 5+)
- **SBA Requirements Engine** - "You're eligible, here's the 23 docs you need"
- **SBA Forms Mapper** - Auto-fill 1919, 159, 413, 912 from wizard answers
- **Preflight QA** - "Your package has 3 blocking issues before submission"
- **Underwriter Console** - SBA tab with readiness score, checklist coverage, forms preview

---

## 🔧 Technical Notes

### Database Schema Required
```sql
-- borrower_applications
ALTER TABLE borrower_applications ADD COLUMN IF NOT EXISTS sba7a_candidate BOOLEAN;
ALTER TABLE borrower_applications ADD COLUMN IF NOT EXISTS sba7a_eligible BOOLEAN;
ALTER TABLE borrower_applications ADD COLUMN IF NOT EXISTS sba7a_ineligibility_reasons JSONB;
ALTER TABLE borrower_applications ADD COLUMN IF NOT EXISTS loan_type TEXT;

-- borrower_answers (assumed to exist with these columns)
-- - application_id (UUID FK)
-- - section (TEXT)
-- - question_key (TEXT)
-- - value (JSONB)
-- - updated_at (TIMESTAMP)
-- UNIQUE INDEX on (application_id, question_key)
```

### Environment Variables
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 📊 Decision Matrix

| User Answer | Result | Track | Reason Code |
|-------------|--------|-------|-------------|
| Federal debt = Yes | INELIGIBLE | CONVENTIONAL | FEDERAL_DEBT_DELINQUENT |
| Ineligible biz = Yes | INELIGIBLE | CONVENTIONAL | INELIGIBLE_BUSINESS |
| Owners not US = Yes | INELIGIBLE | CONVENTIONAL | OWNERS_NOT_US_ELIGIBLE |
| Criminal history = Yes | INELIGIBLE | CONVENTIONAL | CRIMINAL_HISTORY_FLAG |
| Prohibited proceeds = Yes | INELIGIBLE | CONVENTIONAL | PROCEEDS_PROHIBITED |
| Exceeds size = Yes | INELIGIBLE | CONVENTIONAL | EXCEEDS_SIZE_STANDARD |
| All gates clear | ELIGIBLE | SBA_7A | (none) |
| Missing critical info | UNKNOWN | UNKNOWN | (missing list) |
| Not SBA candidate | UNKNOWN | CONVENTIONAL | NOT_SBA_CANDIDATE_YET |

---

## 🚀 Next Steps (Your Choice)

**Option 1: Extend Eligibility Engine**
- Add NAICS-based ineligible business taxonomy
- Add size standards lookup by NAICS code
- Add SBA 7(a) vs 504 program recommendation logic
- Add specific use-of-proceeds validation

**Option 2: Proceed to Step 5 (Requirements Engine)**
- Build SOP-aware checklists based on eligibility result
- Map scenarios to document requirements
- Create `src/lib/sba/requirements/` module

**Option 3: Proceed to Step 6 (Forms Mapper)**
- Auto-fill SBA forms from wizard answers
- Generate JSON payloads for 1919, 159, 413, 912
- Validate form completeness

**Option 4: Proceed to Step 7 (Preflight QA)**
- Build rejection risk scanner
- Check for missing fields, conflicts, doc quality
- Output SBA_Readiness_Score (0-100)

**Option 5: Proceed to Step 8 (Underwriter Console)**
- Add SBA tab to deal workspace
- Show eligibility status, checklist, forms readiness
- "Generate SBA Package" button

---

## 📝 Summary

**What you have now:**
- ✅ Clean, deterministic SBA 7(a) eligibility engine
- ✅ Borrower wizard with auto-routing (SBA vs Conventional)
- ✅ Real-time eligibility feedback with explainable reasons
- ✅ Server-truth persistence (no client-side guessing)
- ✅ Production-ready API endpoints
- ✅ Supabase integration for answers + results

**What's different from v0:**
- 🎯 **Simpler, cleaner** - Focused on hard gates (v1), not 60+ fields
- 🔒 **Conservative** - Returns UNKNOWN instead of false positives
- 📊 **Explainable** - Every reason has stable code + message + severity
- 🔄 **Real-time** - Recomputes on every answer change
- 🛤️ **Auto-routing** - Wizard dynamically shows SBA vs Conventional sections

**Philosophy:**
> "Deterministic where SBA is deterministic, evidence-driven where SBA is interpretive, auditable (every 'because' has a trail), workflow-native."

✅ **READY FOR PRODUCTION SMOKE TEST** ✅
