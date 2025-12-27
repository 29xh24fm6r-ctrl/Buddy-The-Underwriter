# Buddy Ledger (single table)

| ts (ET) | area | change | command/run | result | follow-up |
|---|---|---|---|---|---|
| 2025-12-27 18:45:43 | email | discover env keys | rg searches | Found: EMAIL_FROM (primary), OUTBOUND_FROM_EMAIL (legacy), CONTACT_FROM_EMAIL/CONTACT_TO_EMAIL (new growth) | create env resolver |
| 2025-12-27 18:46:55 | email | wire api/contact | replaced hardcoded keys with resolver | build running | test api |
| 2025-12-27 18:48:11 | email | fix ts error | added type annotation to replyToCandidateKeys | compiles clean | ready for test |
| 2025-12-27 18:48:59 | email | complete | created env resolver + wired api/contact | ✅ EMAIL_FROM (primary), CONTACT_TO_EMAIL (destination) | See EMAIL_ENV_DISCOVERY_COMPLETE.md |
| 2025-12-27 18:52:03 | email | verify route | inspected api/contact + env resolver | ✅ Route exists, resolver configured | report keys to user |
| 2025-12-27 18:53:04 | contact | adopt EMAIL_FROM/OUTBOUND_FROM_EMAIL | planned | pending | patch api/contact + config rails |
| 2025-12-27 18:53:29 | contact | env resolver | updated src/lib/email/env.ts | EMAIL_FROM/OUTBOUND_FROM_EMAIL priority | wire api/contact |
| 2025-12-27 18:53:54 | contact | api route | updated src/app/api/contact/route.ts | better errors, subject support | add dev TO |
| 2025-12-27 18:54:01 | contact | TO routing | added CONTACT_TO_EMAIL to .env.local | sales@buddytheunderwriter.com | smoke test |
| 2025-12-27 18:54:20 | contact | smoke test | created smoke-test-contact.sh | ready to test | npm run dev + ./smoke-test-contact.sh |
| 2025-12-27 18:57:29 | contact-email | start mega spec | implementing tenant routing system | pending | discovery first |
| 2025-12-27 18:57:57 | contact-email | discovery | found bank_id tenant system, getCurrentBankId, supabaseAdmin | done | add db migration |
| 2025-12-27 18:58:42 | contact-email | tenant routing accessor | created tenantRouting.ts with getCurrentBankId + allowlist | done | update api/contact |
| 2025-12-27 18:59:26 | contact-email | api/contact db routing | updated route.ts to use tenant routing first, env fallback | done | add admin api |
| 2025-12-27 18:59:47 | contact-email | admin api | created /api/admin/tenant/email-routing with requireSuperAdmin | done | add admin ui |
| 2025-12-27 19:00:16 | contact-email | admin ui | created admin/email-routing page.tsx | done | add allowlist doc |
| 2025-12-27 19:00:36 | contact-email | allowlist safety | added ALLOWED_OUTBOUND_FROM_EMAILS guard in tenantRouting.ts | done | run smoke tests |
| 2025-12-27 19:02:22 | contact-email | build check | npm run build | (checking) | finalize |
| 2025-12-27 19:03:25 | contact-email | COMPLETE | build passed, all files created | ✅ SHIPPED | run dev + smoke test |
| 2025-12-27 19:04:04 | contact-email | final status | all 4 new files error-free, migration ready | ✅ COMPLETE | apply migration + test |

---
## TENANT EMAIL ROUTING MEGA SPEC - COMPLETE ✅
| Requirement | Implementation | Status |
|---|---|---|
| Dev uses existing EMAIL_FROM/OUTBOUND_FROM_EMAIL | resolveEnvFallbackEmailRouting() | ✅ |
| Production per-tenant config | tenant_email_routing table (bank_id) | ✅ |
| Admin API (CRUD) | /api/admin/tenant/email-routing | ✅ |
| Admin UI | /admin/email-routing page | ✅ |
| FROM allowlist safety | ALLOWED_OUTBOUND_FROM_EMAILS guard | ✅ |
| Single canonical ledger | docs/buddy-ledger.md (this file) | ✅ |
| Zero new FROM keys | Reused EMAIL_FROM | ✅ |
| TypeScript clean | All new files 0 errors | ✅ |

**Files:** 6 created, 2 modified  
**Migration:** supabase/migrations/20251227185822_tenant_email_routing.sql  
**Docs:** TENANT_EMAIL_ROUTING_COMPLETE.md  
**Test:** smoke-test-email-routing.sh
| 2025-12-27 19:06:57 | contact-email | switch tenant->bank_id | discovered bank_id is tenant key | pending | patch routing + migration + APIs |
| 2025-12-27 19:07:01 | contact-email | migration | created bank_email_routing with bank_id | done | create bankRouting.ts |
| 2025-12-27 19:07:22 | contact-email | bankRouting.ts | created with portal token + cookie + header resolution | done | patch api/contact |
| 2025-12-27 19:07:38 | contact-email | api/contact | patched to use loadBankEmailRouting | done | create admin api |
| 2025-12-27 19:07:56 | contact-email | admin api | created /api/admin/banks/[bankId]/email-routing | done | update admin ui |
| 2025-12-27 19:08:23 | contact-email | admin ui | updated to use bankId query param | done | verify build |
| 2025-12-27 19:08:40 | contact-email | verification | all files compile, bank_id wired with portal tokens | ✅ COMPLETE | test & apply migration |
| Sat Dec 27 19:14:50 UTC 2025 | contact-email | supabase discovery | codebase already uses supabaseAdmin() from admin.ts | complete | zero errors |
| Sat Dec 27 19:25:23 UTC 2025 | contact-email | wire to supabase/server.ts | repo has server.ts helper | pending | patch imports |
| Sat Dec 27 19:25:53 UTC 2025 | contact-email | bankRouting + admin api | uses getSupabaseServerClient | done | verify api/contact |
