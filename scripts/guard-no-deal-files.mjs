import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const hits = execSync(`bash -lc "grep -RIn \\"from(\\\\\\\"deal_files\\\\\\\")|from('deal_files')|deal_files\\b\\" src || true"`, {
  encoding: "utf8",
});

const allowed = [
  "src/app/api/deals/[dealId]/files/list/route.ts",
  "src/app/api/deals/[dealId]/files/signed-url/route.ts",
  "src/app/api/deals/[dealId]/documents/evidence/route.ts",
].join("\n");

const bad = hits
  .split("\n")
  .filter(Boolean)
  .filter((line) => !allowed.split("\n").some((a) => line.includes(a)));

if (bad.length) {
  console.error("❌ Legacy deal_files references detected:\n" + bad.join("\n"));
  process.exit(1);
}

console.log("✅ No unexpected deal_files references.");
