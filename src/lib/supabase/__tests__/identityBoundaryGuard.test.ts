import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const repairedRoutes = [
  "src/app/api/usage/route.ts",
  "src/app/api/screens/[id]/claim/route.ts",
  "src/app/api/screens/[id]/continue/route.ts",
  "src/app/api/tenant/select/route.ts",
  "src/app/tenant/select/page.tsx",
  "src/app/api/deals/[dealId]/conditions/add/route.ts",
  "src/app/api/deals/[dealId]/conditions/list/route.ts",
  "src/app/api/deals/[dealId]/conditions/generate-from-mitigants/route.ts",
  "src/app/api/deals/[dealId]/conditions/[conditionId]/route.ts",
  "src/app/api/deals/[dealId]/conditions/set-status/route.ts",
  "src/app/api/deals/[dealId]/policy/evaluate/route.ts",
  "src/app/api/deals/[dealId]/policy/mitigants/route.ts",
] as const;

const privilegedDealRoutes = [
  "src/app/api/deals/[dealId]/replay/route.ts",
  "src/app/api/deals/[dealId]/delight/route.ts",
  "src/app/api/deals/[dealId]/examiner/route.ts",
  "src/app/api/deals/[dealId]/examiner/simulate/route.ts",
  "src/app/api/deals/[dealId]/missing-docs/route.ts",
  "src/app/api/deals/[dealId]/recompute/route.ts",
  "src/app/api/deals/[dealId]/ask/route.ts",
  "src/app/api/deals/[dealId]/memo/generate/route.ts",
] as const;

const borrowerTokenRoutes = [
  "src/app/api/borrower/[token]/submit/route.ts",
  "src/app/api/borrower/[token]/upload-event/route.ts",
] as const;

test("privileged Supabase compatibility clients are server-only and fail closed", () => {
  const server = read("src/lib/supabase/server.ts");
  assert.match(server, /import "server-only"/);
  assert.match(server, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(server, /service\?\.trim\(\) \? service : anon/);
  assert.match(server, /if \(!response\.ok \|\| !payload\.token\)/);

  const legacy = read("src/lib/supabase/client.ts");
  assert.match(legacy, /import "server-only"/);
  assert.match(legacy, /supabaseAdmin\(\)/);
  assert.doesNotMatch(legacy, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(legacy, /SUPABASE_SERVICE_ROLE_KEY\s*\|\|/);
});

test("browser auth never imports the privileged compatibility client", () => {
  const authClient = read("src/app/auth/AuthClient.tsx");
  assert.match(authClient, /@\/lib\/supabase\/browser/);
  assert.doesNotMatch(authClient, /@\/lib\/supabase\/client/);
});

test("user-driven routes do not authenticate against a sessionless service client", () => {
  for (const path of repairedRoutes) {
    const route = read(path);
    assert.doesNotMatch(
      route,
      /\.auth\.getUser\(/,
      `${path} must authenticate through Clerk before privileged queries`,
    );
    assert.doesNotMatch(
      route,
      /@\/lib\/supabase\/server/,
      `${path} must not use the ambiguous legacy server client`,
    );
  }

  assert.match(
    read("src/app/api/usage/route.ts"),
    /resolveUserApiContext/,
  );
  assert.match(
    read("src/app/api/screens/[id]/claim/route.ts"),
    /actorProfileId/,
  );
  assert.match(
    read("src/app/api/tenant/select/route.ts"),
    /\.eq\("clerk_user_id", userId\)/,
  );

  for (const path of repairedRoutes.filter(
    (path) => path.includes("/conditions/") || path.includes("/policy/"),
  )) {
    assert.match(
      read(path),
      /resolveDealApiContext/,
      `${path} must enforce canonical deal tenant access`,
    );
  }
});

test("all service-role deal routes enforce Clerk and tenant authorization", () => {
  for (const path of privilegedDealRoutes) {
    const route = read(path);
    assert.match(
      route,
      /resolveDealApiContext/,
      `${path} must enforce canonical deal tenant access`,
    );
    assert.doesNotMatch(route, /@\/lib\/supabase\/server/);
  }
});

test("borrower mutations bind a valid portal token to its deal", () => {
  for (const path of borrowerTokenRoutes) {
    const route = read(path);
    assert.match(route, /resolveBorrowerToken\(token\)/);
    assert.match(route, /resolved\.deal_id/);
    assert.match(route, /borrower_link_deal_mismatch/);
    assert.doesNotMatch(route, /@\/lib\/supabase\/server/);
  }
});

test("canonical route contexts separate Clerk IDs from UUID actor IDs", () => {
  const userContext = read("src/lib/server/userApiContext.ts");
  assert.match(userContext, /clerkAuth\(\)/);
  assert.match(userContext, /\.eq\("clerk_user_id", clerkUserId\)/);
  assert.match(userContext, /actorProfileId/);
  assert.match(userContext, /supabaseAdmin\(\)/);

  const dealContext = read("src/lib/server/dealApiContext.ts");
  assert.match(dealContext, /resolveUserApiContext\(\)/);
  assert.match(dealContext, /String\(dealResult\.data\.bank_id\) !== String\(bankId\)/);
  assert.match(dealContext, /deal_fetch_failed/);
  assert.match(dealContext, /wrong_bank/);
});

test("Clerk-to-Supabase JWT subject matches Buddy's RLS identity", () => {
  const exchange = read("src/app/api/auth/supabase-jwt/route.ts");
  assert.match(exchange, /\.from\("profiles"\)/);
  assert.match(exchange, /\.eq\("clerk_user_id", clerkUserId\)/);
  assert.match(exchange, /\.setSubject\(buddyUserId\)/);
  assert.match(exchange, /app_user_id: appUserId/);
  assert.match(exchange, /profile_id: buddyUserId/);
  assert.doesNotMatch(exchange, /\.setSubject\(appUserId\)/);
});

test("usage increments never downgrade to a non-atomic fallback", () => {
  const limits = read("src/lib/usage/limits.ts");
  assert.match(limits, /throw error/);
  assert.doesNotMatch(limits, /\.raw\(/);
  assert.doesNotMatch(limits, /free_continues_used \+ 1/);
});

test("usage SECURITY DEFINER function is service-role only", () => {
  const migration = read(
    "supabase/migrations/20260826163000_usage_function_privilege_boundary.sql",
  );
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public, pg_temp/i);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(
    migration,
    /revoke all on function public\.increment_continue_usage\(uuid\) from public/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.increment_continue_usage\(uuid\) from authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.increment_continue_usage\(uuid\) to service_role/i,
  );
});
