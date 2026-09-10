import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("destructive CRM access is admin-only", () => {
  const auth = read("src/lib/auth/requireBrokerageStaff.ts");
  assert.match(auth, /requireBrokerageAdmin/);
  assert.match(auth, /resolved\.role === "underwriter"/);
});

test("CRM deletes are bank-scoped, confirmed, audited, and fail closed", () => {
  const route = read("src/app/api/admin/brokerage/crm/[...path]/route.ts");
  const files = [
    "src/app/api/admin/brokerage/crm/[...path]/_handlers/organizations-orgId.ts",
    "src/app/api/admin/brokerage/crm/[...path]/_handlers/people-personId.ts",
    "src/app/api/admin/brokerage/crm/[...path]/_handlers/leads-leadId.ts",
    "src/app/api/admin/brokerage/crm/[...path]/_handlers/activities.ts",
  ];
  const handlers = files.map(read).join("\n");

  assert.match(route, /method === "DELETE"/);
  assert.match(handlers, /requireBrokerageAdmin/);
  assert.match(handlers, /beginCrmDeletion/);
  assert.match(handlers, /\.eq\("bank_id"/);
  assert.match(handlers, /delete_preflight_failed/);
  assert.match(handlers, /delete_not_confirmed/);
  assert.match(handlers, /record_in_use/);
});

test("destructive UI requires explicit confirmation and database keeps service-only receipts", () => {
  const controls = read("src/components/brokerage/CrmDeleteControls.tsx");
  const migration = read("supabase/migrations/20260910152547_crm_admin_deletion_audit.sql");
  assert.match(controls, /This cannot be undone/);
  assert.match(controls, /Type <strong>\{label\}<\/strong> to confirm/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all .* anon, authenticated/i);
  assert.match(migration, /grant all .* service_role/i);
});
