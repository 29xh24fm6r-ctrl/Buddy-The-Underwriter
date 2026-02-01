# Buddy — Loan Ops OS (Underwriter)

Buddy is a multi-tenant commercial lending operating system for SBA + CRE underwriting.

**Core primitives**
- Document intelligence (OCR + classification)
- Deterministic checklist/conditions engines (AI annotates/explains, never decides truth)
- Borrower portal + guided uploads
- Audit-grade event ledger + pipeline runs
- Banker command center + package generation
- **Claude MCP integration** (connect Claude Desktop to Buddy via Model Context Protocol)

## Stack
Next.js (App Router) • TypeScript • Supabase • Clerk • OpenAI/Gemini • Twilio • Resend • PostHog/Sentry

## Repo structure
- `src/` — application code (canonical)
- `supabase/migrations/` — database migrations (canonical)
- `docs/canon/` — system rules + invariants
- `docs/build-logs/` — historical build logs
- `mcp-server/` — Claude Desktop MCP integration

## Local dev
```bash
pnpm install
pnpm dev
```

## Claude MCP Integration

Connect Claude Desktop to Buddy for AI-assisted underwriting operations. See [CLAUDE_MCP_SETUP.md](./CLAUDE_MCP_SETUP.md) for setup instructions.

```bash
# Build MCP server
npm run build:mcp
```


