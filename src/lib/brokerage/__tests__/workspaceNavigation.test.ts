import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BROKERAGE_HOME, BROKERAGE_WORKSPACE_LINKS, brokerageAdminEntryPath, activeBrokerageWorkspaceLink } from "../workspaceNavigation";

test("BuddySBA admin entry opens brokerage home and preserves explicit admin destinations", () => {
  assert.equal(brokerageAdminEntryPath(), BROKERAGE_HOME);
  assert.equal(brokerageAdminEntryPath([]), BROKERAGE_HOME);
  assert.equal(brokerageAdminEntryPath(["brokerage", "pipeline"]), "/admin/brokerage/pipeline");
  assert.equal(brokerageAdminEntryPath(["brokerage", "crm", "a b"]), "/admin/brokerage/crm/a%20b");
});
test("primary workspace links resolve to existing staff pages, not the bank deal list", () => {
  for (const { href } of BROKERAGE_WORKSPACE_LINKS) {
    assert.ok(href.startsWith("/admin/brokerage"));
    if (href === "/admin/brokerage/crm/buyers") {
      const router = readFileSync(path.join(process.cwd(), "src/app/admin/brokerage/crm/[orgId]/page.tsx"), "utf8");
      assert.match(router, /orgId === "buyers"/);
      assert.match(router, /<BankBuyersWorkspace/);
    } else {
      assert.ok(existsSync(path.join(process.cwd(), "src/app", href, "page.tsx")), href);
    }
  }
});
test("lender placements is selected instead of the parent CRM destination", () => {
  assert.equal(activeBrokerageWorkspaceLink("/admin/brokerage"), "/admin/brokerage");
  assert.equal(activeBrokerageWorkspaceLink("/admin/brokerage/pipeline/new"), "/admin/brokerage/pipeline");
  assert.equal(activeBrokerageWorkspaceLink("/admin/brokerage/unlisted"), undefined);
  assert.equal(activeBrokerageWorkspaceLink("/admin/brokerage/crm-other"), undefined);
  assert.equal(activeBrokerageWorkspaceLink("/admin/brokerage/crm/buyers"), "/admin/brokerage/crm/buyers");
  assert.equal(activeBrokerageWorkspaceLink("/admin/brokerage/crm/people"), "/admin/brokerage/crm");
  assert.equal(activeBrokerageWorkspaceLink("/deals"), undefined);
});
test("both public admin gateways use the shared entry while staff authentication stays intact", () => {
  for (const route of ["brokerage", "go"]) {
    const source = readFileSync(path.join(process.cwd(), `src/app/${route}/admin/[[...path]]/page.tsx`), "utf8");
    assert.match(source, /brokerageAdminEntryPath\(path\)/);
    assert.match(source, /APP_ORIGIN/);
  }
  const layout = readFileSync(path.join(process.cwd(), "src/app/admin/brokerage/layout.tsx"), "utf8");
  assert.match(layout, /await requireBrokerageStaffPage\(\)/);
});
