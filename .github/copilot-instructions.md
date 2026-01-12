# Buddy The Underwriter - AI Agent Guide

## Project Overview
**Buddy** is a production SBA loan underwriting platform built with Next.js 16 (App Router), Supabase, Clerk, and OpenAI. It's a multi-tenant (bank-level) system for commercial loan processing, document intelligence, and borrower automation.

## Critical Architecture Patterns

### Multi-Tenant System
- **Tenant Resolution**: Every authenticated request must resolve `bank_id` via `getCurrentBankId()` from `@/lib/tenant/getCurrentBankId`
- **Auto-selection logic**: 0 memberships → error, 1 membership → auto-select, 2+ → user picks bank
- **RLS Architecture**: Most tables use "deny-all" RLS policies; access via `supabaseAdmin()` with server-side tenant checks
- **Guard Scripts**: Run `npm run guard:tenant-rls` to verify RLS compliance before commits

### Database Access Patterns
```typescript
// Server-side: ALWAYS use this pattern
import { supabaseAdmin } from "@/lib/supabase/admin";
const sb = supabaseAdmin();

// NEVER: Don't instantiate null clients or skip tenant checks
// NEVER: Don't use service_role in client components
```

**Three Supabase clients**:
1. `supabaseAdmin()` - Service role, server-only, bypasses RLS (most common)
2. `supabaseServer()` - Server with Clerk auth forwarded (rare, for RLS testing)
3. `supabaseClient()` - Client-side anon key (very rare, mostly unused)

### API Route Structure
- **Next.js 16 async params**: `params` is now `Promise<{ id: string }>`, must await
- **Auth pattern**: Admin routes require `requireSuperAdmin()` from `@/lib/auth/requireAdmin`
- **Error handling**: Return `{ ok: false, error: string }` not thrown errors
- **Route exports**: Use `export async function GET/POST/PUT/PATCH/DELETE(req, ctx)`

### AI Integration
- **Wrapper**: Use `aiJson()` from `@/lib/ai/openai` - handles timeouts, retries, JSON extraction
- **Principle**: "AI explains, rules decide" - AI generates explanations/suggestions, deterministic code controls state
- **Never trust AI**: All business logic (eligibility, conditions, approvals) is rule-based; AI only annotates
- **Voice**: OpenAI Realtime API for borrower interviews (`/api/realtime/session`)

### Stitch Import System
- **Purpose**: Import UI designs from Stitch.ai without manual HTML conversion
- **Import command**: `node scripts/stitch/import-stitch.mjs <input.html> <output.tsx>`
- **StitchFrame**: Wrapper component that injects Tailwind CDN + config into iframe
- **Pattern**: Store Stitch HTML verbatim, no className conversions needed
- **Location**: Stitch exports in `stitch_exports/`, generated pages use `<StitchFrame>`

### Document Intelligence Pipeline
- **OCR**: Gemini OCR via Vertex AI (environment: `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_CLOUD_PROJECT` + `USE_GEMINI_OCR=true`)
- **Text extraction**: PDF.js for table detection, hybrid approach for financials
- **Quality scoring**: `scoreTableQuality()` and `scoreTextLayer()` in `@/lib/extract/quality/`
- **Pack system**: "Packs" are grouped document requirements (e.g., "Business Tax Return Pack" = 3 years + schedules)
- **Intelligence events**: Write to `borrower_pack_learning_events` on every upload for ML training

### Conditions & Underwriting
- **Conditions engine**: Lives in `@/lib/conditions/evaluate.ts` - deterministic, rule-based
- **Auto-resolution**: Conditions recompute when docs uploaded/classified via hooks in `@/lib/conditions/hooks.ts`
- **SBA 20% rule**: Owners ≥20% require personal financial package (PFS + 3yr tax + guaranty)
- **Ownership inference**: AI suggests ownership % from uploaded docs (K-1s, operating agreements)
- **E-Tran**: XML generation for SBA submissions (human-approval required, never auto-submit)

### Reminder & Notification System
- **Architecture**: Server-side queue (`deal_owner_outreach_queue`, `reminder_runs`)
- **Idempotency**: Uses PostgreSQL advisory locks (`pg_try_advisory_lock`) to prevent double-sends
- **Tick route**: `POST /api/admin/reminders/tick` processes pending reminders
- **No client emails**: All outbound messaging goes through server queues
- **Health monitoring**: Check `/api/admin/reminders/stats` for error rates

### Client/Server Boundaries
- **Server Components**: Default for pages, can directly query Supabase
- **Client Components**: Use `"use client"` only when needed (interactivity, hooks)
- **Server Actions**: NOT used in this codebase; prefer API routes
- **Server-only imports**: `import "server-only"` in libs that touch secrets

## Development Workflows

### Running Locally
```bash
npm run dev              # Start Next.js dev server
npm run build            # Production build (checks types)
npm run lint             # ESLint
npm run guard:canonical  # Run all guard scripts
```

### Guard Scripts (Run Before Committing)
- `npm run guard:admin` - Ensure all `/api/admin/*` routes have `requireSuperAdmin()`
- `npm run guard:canonical` - Verify no legacy reminder fields, canonical subscriptions
- `npm run guard:tenant-rls` - Check RLS policies on tenant tables

### Database Migrations
- **Location**: `supabase/migrations/` (timestamp-prefixed SQL files)
- **Apply**: Run in Supabase SQL Editor or via `psql $DATABASE_URL -f migration.sql`
- **Testing**: Verification queries in `scripts/verification-queries.sql`

### Testing Commands (Shell Scripts)
- `./test-pricing-memo.sh <dealId>` - Test pricing memo generation
- `./test-pdf-generation.sh` - Test PDF overlay system
- `./test-upload-intel.sh` - Test document intelligence
- `./scripts/test-bulletproof-reminders.sh` - Test reminder idempotency

## Common Gotchas

### ❌ Don't Do This
```typescript
// Wrong: Missing tenant check
const sb = supabaseAdmin();
const { data } = await sb.from('deals').select('*');

// Wrong: Null Supabase client
const sb = null as any;

// Wrong: Forgetting async params in Next.js 16
export async function GET(req, { params }: Ctx) {
  const { dealId } = params; // ERROR: params is Promise
}
```

### ✅ Do This Instead
```typescript
// Correct: Tenant-scoped query
const sb = supabaseAdmin();
const bankId = await getCurrentBankId();
const { data } = await sb.from('deals').select('*').eq('bank_id', bankId);

// Correct: Real Supabase client
const sb = supabaseAdmin();

// Correct: Await async params
export async function GET(req, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
}
```

## File Organization
- **`src/app/`**: Next.js App Router pages & API routes
- **`src/components/`**: React components (mostly client components for UI)
- **`src/lib/`**: Business logic libraries (tenant, finance, extract, conditions, etc.)
- **`src/ai/`**: AI orchestration (separate from `src/lib/ai/openai.ts` wrapper)
- **`supabase/migrations/`**: SQL schema migrations
- **`scripts/`**: Guard scripts, Stitch import, testing utilities
- **`stitch_exports/`**: Original Stitch HTML files (source of truth for UI designs)

## Key Conventions
- **Imports**: Always use `@/` aliases, never relative paths across boundaries
- **Async/await**: Every Supabase call, every AI call - no `.then()` chains
- **Type safety**: TypeScript strict mode, use `any` only in `Database` type (until types generated)
- **Error logging**: Return structured errors `{ ok: false, error: string }`, log to console.error
- **Naming**: `snake_case` for DB columns, `camelCase` for TS variables, `PascalCase` for components

## Environment Variables (Required)
```bash
# Core
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...

# AI
OPENAI_API_KEY=sk-...

# Gemini OCR
USE_GEMINI_OCR=true
GOOGLE_CLOUD_PROJECT=...
GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json
GOOGLE_API_KEY=...

# Email (optional)
RESEND_API_KEY=re_...

# SBA (for E-Tran submission)
SBA_LENDER_ID=...
SBA_SERVICE_CENTER=...
```

## Documentation References
- **Multi-tenant setup**: `TENANT_SYSTEM_COMPLETE.md`
- **Conditions engine**: `CONDITIONS_README.md`
- **Reminder system**: `BULLETPROOF_REMINDER_SYSTEM.md`
- **Pack intelligence**: `PACK_INTEGRATION_COMPLETE.md`
- **Ownership tracking**: `OWNERSHIP_SYSTEM_COMPLETE.md`
- **Stitch imports**: `STITCH_IMPORT.md`
- **Deployment**: `DEPLOYMENT.md`

## Next Steps for New Features
1. Check if tenant-scoped (most are) → add `bank_id` column + RLS policy
2. Create migration in `supabase/migrations/`
3. Add API route in `src/app/api/` with tenant check
4. Add business logic in `src/lib/`
5. Run `npm run guard:canonical` before commit
6. Document in root-level `<FEATURE>_COMPLETE.md` file

---

**Ship fast, stay canonical.** This codebase prioritizes deterministic logic over AI magic, server-side queues over client chaos, and tenant isolation over shared state.
