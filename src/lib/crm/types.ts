/**
 * Minimal structural Supabase-client type, matching the convention used
 * throughout src/lib/brokerage/*.ts (e.g. revenueOps.ts) — every domain
 * function takes the db client as a parameter rather than calling
 * supabaseAdmin() internally, so it can run against an in-memory fake in
 * unit tests without a real database.
 */
export type SB = { from: (table: string) => any };
