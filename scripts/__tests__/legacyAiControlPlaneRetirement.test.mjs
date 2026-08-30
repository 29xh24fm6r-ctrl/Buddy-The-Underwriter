import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const retiredRoutes = [
  "src/app/api/ai/command/route.ts",
  "src/app/api/ai/credit-memo/route.ts",
  "src/app/api/ai/execute/route.ts",
  "src/app/api/ai/underwrite/route.ts",
  "src/app/api/pdfs/[pdfId]/route.ts",
  "src/app/api/admin/deals/[dealId]/checklist/debug/route.ts",
  "src/app/api/deals/[dealId]/borrower/debug/route.ts",
];
const retiredEndpoints = [
  "/api/ai/command",
  "/api/ai/credit-memo",
  "/api/ai/execute",
  "/api/ai/underwrite",
  "/checklist/debug",
  "/borrower/debug",
];

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      files.push(...sourceFiles(absolute));
    } else if (/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      files.push(absolute);
    }
  }
  return files;
}

test("legacy and debug control-plane routes stay retired", () => {
  for (const route of retiredRoutes) {
    assert.equal(existsSync(path.join(root, route)), false, route);
  }
});

test("product source has no caller for retired endpoints", () => {
  const offenders = [];
  for (const file of sourceFiles(path.join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const endpoint of retiredEndpoints) {
      if (source.includes(endpoint)) offenders.push(`${path.relative(root, file)} -> ${endpoint}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no API route can resurrect the process-memory action executor", () => {
  const forbiddenImports = [
    "@/lib/ai/executor",
    "@/lib/db/audit",
    "@/lib/db/pdfs",
  ];
  const offenders = [];
  for (const file of sourceFiles(path.join(root, "src/app/api"))) {
    const source = readFileSync(file, "utf8");
    for (const dependency of forbiddenImports) {
      if (source.includes(dependency)) {
        offenders.push(`${path.relative(root, file)} -> ${dependency}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
