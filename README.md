# Buddy — Loan Ops OS (Underwriter)

Buddy is a multi-tenant commercial lending operating system for SBA + CRE underwriting.

**Core primitives**
- Document intelligence (OCR + classification)
- Deterministic checklist/conditions engines (AI annotates/explains, never decides truth)
- Borrower portal + guided uploads
- Audit-grade event ledger + pipeline runs
- Banker command center + package generation

## Stack
Next.js (App Router) • TypeScript • Supabase • Clerk • OpenAI/Gemini • Twilio • Resend • PostHog/Sentry

## Repo structure
- `src/` — application code (canonical)
- `supabase/migrations/` — database migrations (canonical)
- `docs/canon/` — system rules + invariants
- `docs/build-logs/` — historical build logs

## Local dev
```bash
pnpm install
pnpm dev
````

