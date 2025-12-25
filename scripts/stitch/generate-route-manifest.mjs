import fs from "fs";
import path from "path";

const root = "stitch_exports";

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function slugToRoute(slug) {
  // Canonical mapping rules (can evolve)
  const map = new Map([
    ["deals-pipeline-command-center", "/deals"],
    ["deal-intake-console", "/deals/new"],
    ["deals-command-bridge", "/deals/[dealId]/underwriter"],

    ["borrower-task-inbox", "/deals/[dealId]/portal-inbox"],
    ["borrower-document-upload-review", "/deals/[dealId]/borrower-inbox"],
    ["borrower-profile", "/deals/[dealId]/borrower"],

    ["pricing-memo-command-center", "/deals/[dealId]/pricing-memo"],
    ["credit-memo-pdf-template", "/deals/[dealId]/memo-template"],
    ["deal-output-credit-memo-spreads", "/deals/[dealId]/memos/new"],

    ["loan-servicing-command-center", "/servicing"],
    ["portfolio-command-bridge", "/portfolio"],
    ["pipeline-analytics-command-center", "/analytics"],

    ["credit-committee-view", "/credit/committee"],

    ["workout-command-center", "/workout"],
    ["workout-case-file", "/workout/case-file"],
    ["workout-committee-packet", "/workout/committee-packet"],
    ["workout-legal-execution-tracker", "/workout/legal"],

    ["reo-command-center", "/workout/reo"],
    ["chargeoff-recovery-command-center", "/workout/chargeoff"],

    ["audit-compliance-ledger", "/compliance/audit-ledger"],
    ["roles-permissions-control", "/admin/roles"],
    ["merge-field-registry", "/admin/merge-fields"],
    ["document-template-vault", "/templates/vault"],
    ["exceptions-change-review", "/exceptions"],
    ["ocr-review-data-validation", "/ocr/review"],
    ["borrower-control-record", "/borrowers/control-record"],
  ]);

  return map.get(slug) || `/stitch/${slug}`;
}

const dirs = fs.readdirSync(root, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

const items = [];
for (const dir of dirs) {
  const codeHtml = path.join(root, dir, "code.html");
  if (!exists(codeHtml)) continue;
  items.push({
    export: dir,
    codeHtml,
    route: slugToRoute(dir),
    target: `src/app${slugToRoute(dir)}/page.tsx`.replaceAll("//", "/"),
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  count: items.length,
  items,
};

fs.writeFileSync("stitch_route_manifest.json", JSON.stringify(out, null, 2));
console.log(`✅ Wrote stitch_route_manifest.json with ${items.length} entries`);
