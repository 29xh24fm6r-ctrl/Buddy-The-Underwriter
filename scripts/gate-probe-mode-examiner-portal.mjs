#!/usr/bin/env node
/**
 * Gate Probe: Examiner Portal Mode (cc Spec — Mode 3)
 *
 * Validates structural wiring for the examiner portal mode:
 *   1. Examiner auth middleware exists and exports correct functions
 *   2. Examiner access grants module exists
 *   3. Examiner portal API routes exist with grant-based auth
 *   4. Examiner portal pages exist (layout, pages, sub-pages)
 *   5. Integrity verification modules exist
 *   6. Grant-based scope validation (no Clerk auth)
 *   7. All activity is logged
 *   8. Read-only invariant enforced
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let pass = 0;
let fail = 0;

function ok(msg) { pass++; console.log(`  PASS: ${msg}`); }
function notOk(msg) { fail++; console.error(`  FAIL: ${msg}`); }

function fileExists(rel) {
  return existsSync(resolve(ROOT, rel));
}

function readFile(rel) {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

console.log("\n=== Gate Probe: Examiner Portal Mode ===\n");

// ── 1. Examiner Auth Middleware ─────────────────────────

console.log("1) Examiner Auth Middleware");

try {
  const src = readFile("src/lib/examiner/auth.ts");

  if (src.includes("authenticateExaminer")) {
    ok("auth.ts exports authenticateExaminer");
  } else {
    notOk("auth.ts missing authenticateExaminer");
  }

  if (src.includes("checkExaminerScope")) {
    ok("auth.ts exports checkExaminerScope");
  } else {
    notOk("auth.ts missing checkExaminerScope");
  }

  if (src.includes("canExaminerDownload")) {
    ok("auth.ts exports canExaminerDownload");
  } else {
    notOk("auth.ts missing canExaminerDownload");
  }

  if (src.includes("extractGrantId")) {
    ok("auth.ts exports extractGrantId");
  } else {
    notOk("auth.ts missing extractGrantId");
  }

  // Auth uses grant-based auth, NOT Clerk
  if (!src.includes("currentUser") && !src.includes("clerk")) {
    ok("auth.ts does not use Clerk (grant-based only)");
  } else {
    notOk("auth.ts should not use Clerk for examiner auth");
  }

  if (src.includes("Bearer")) {
    ok("auth.ts supports Bearer token extraction");
  } else {
    notOk("auth.ts missing Bearer token support");
  }

  if (src.includes("grant_id")) {
    ok("auth.ts supports grant_id query param");
  } else {
    notOk("auth.ts missing grant_id support");
  }
} catch (e) {
  notOk(`auth.ts read failed: ${e.message}`);
}

// ── 2. Examiner Access Grants Module ────────────────────

console.log("\n2) Examiner Access Grants Module");

try {
  const src = readFile("src/lib/examiner/examinerAccessGrants.ts");

  const fns = [
    "createExaminerGrant",
    "getActiveGrant",
    "getGrantsForBank",
    "revokeGrant",
    "validateGrantScope",
    "logExaminerActivity",
  ];

  for (const fn of fns) {
    if (src.includes(fn)) {
      ok(`examinerAccessGrants exports ${fn}`);
    } else {
      notOk(`examinerAccessGrants missing ${fn}`);
    }
  }

  // Grant structure
  if (src.includes("ExaminerAccessGrant") && src.includes("ExaminerAccessScope")) {
    ok("examinerAccessGrants exports grant types");
  } else {
    notOk("examinerAccessGrants missing grant types");
  }

  // Time-bounded
  if (src.includes("expires_at")) {
    ok("Grants are time-bounded (expires_at)");
  } else {
    notOk("Grants missing time-bounding");
  }

  // Revocable
  if (src.includes("revoked_at")) {
    ok("Grants are revocable (revoked_at)");
  } else {
    notOk("Grants missing revocation support");
  }
} catch (e) {
  notOk(`examinerAccessGrants.ts read failed: ${e.message}`);
}

// ── 3. Examiner Portal API Routes ───────────────────────

console.log("\n3) Examiner Portal API Routes");

const portalRoutes = [
  "src/app/api/examiner/portal/deals/[dealId]/route.ts",
  "src/app/api/examiner/portal/deals/[dealId]/verify/route.ts",
  "src/app/api/examiner/grants/route.ts",
  "src/app/api/examiner/grants/[grantId]/revoke/route.ts",
  "src/app/api/examiner/playbooks/route.ts",
];

for (const route of portalRoutes) {
  if (fileExists(route)) {
    ok(`${route} exists`);
  } else {
    notOk(`${route} does not exist`);
  }
}

// Portal deal route checks
try {
  const src = readFile("src/app/api/examiner/portal/deals/[dealId]/route.ts");

  if (src.includes("grant_id")) {
    ok("Portal deal route uses grant_id auth");
  } else {
    notOk("Portal deal route missing grant_id auth");
  }

  if (src.includes("getActiveGrant")) {
    ok("Portal deal route validates grant");
  } else {
    notOk("Portal deal route missing grant validation");
  }

  if (src.includes("validateGrantScope")) {
    ok("Portal deal route validates scope");
  } else {
    notOk("Portal deal route missing scope validation");
  }

  if (src.includes("logExaminerActivity")) {
    ok("Portal deal route logs activity");
  } else {
    notOk("Portal deal route missing activity logging");
  }

  if (src.includes("respond200")) {
    ok("Portal deal route uses respond200 (never-500)");
  } else {
    notOk("Portal deal route missing respond200");
  }

  // Read-only: no mutations
  if (src.includes("export async function GET") && !src.includes("export async function POST") && !src.includes("export async function PUT") && !src.includes("export async function DELETE")) {
    ok("Portal deal route is GET-only (read-only)");
  } else {
    notOk("Portal deal route should be GET-only");
  }
} catch (e) {
  notOk(`Portal deal route read failed: ${e.message}`);
}

// Verify route checks
try {
  const src = readFile("src/app/api/examiner/portal/deals/[dealId]/verify/route.ts");

  if (src.includes("verifySnapshotHash") || src.includes("computeSnapshotHash")) {
    ok("Verify route uses integrity verification");
  } else {
    notOk("Verify route missing integrity verification");
  }

  if (src.includes("logExaminerActivity")) {
    ok("Verify route logs verification activity");
  } else {
    notOk("Verify route missing activity logging");
  }
} catch (e) {
  notOk(`Verify route read failed: ${e.message}`);
}

// ── 4. Examiner Portal Pages ────────────────────────────

console.log("\n4) Examiner Portal Pages");

const portalPages = [
  "src/app/(examiner)/examiner-portal/layout.tsx",
  "src/app/(examiner)/examiner-portal/page.tsx",
  "src/app/(examiner)/examiner-portal/deals/[dealId]/page.tsx",
  "src/app/(examiner)/examiner-portal/deals/[dealId]/borrower/page.tsx",
  "src/app/(examiner)/examiner-portal/deals/[dealId]/decision/page.tsx",
  "src/app/(examiner)/examiner-portal/deals/[dealId]/integrity/page.tsx",
  "src/app/(examiner)/examiner-portal/deals/[dealId]/traces/page.tsx",
  "src/app/(examiner)/examiner-portal/playbooks/page.tsx",
];

for (const page of portalPages) {
  if (fileExists(page)) {
    ok(`${page.replace("src/app/(examiner)/examiner-portal/", "")} exists`);
  } else {
    notOk(`${page.replace("src/app/(examiner)/examiner-portal/", "")} does not exist`);
  }
}

// Layout checks
try {
  const src = readFile("src/app/(examiner)/examiner-portal/layout.tsx");
  if (src.includes("use client")) {
    ok("Examiner layout is client component");
  } else {
    notOk("Examiner layout missing 'use client'");
  }
  if (src.includes("Read-Only")) {
    ok("Examiner layout shows read-only indicator");
  } else {
    notOk("Examiner layout missing read-only indicator");
  }
} catch (e) {
  notOk(`Examiner layout read failed: ${e.message}`);
}

// Portal landing page checks
try {
  const src = readFile("src/app/(examiner)/examiner-portal/page.tsx");
  if (src.includes("grant_id")) {
    ok("Portal landing requires grant_id");
  } else {
    notOk("Portal landing missing grant_id requirement");
  }
} catch (e) {
  notOk(`Portal landing read failed: ${e.message}`);
}

// Integrity page checks
try {
  const src = readFile("src/app/(examiner)/examiner-portal/deals/[dealId]/integrity/page.tsx");
  if (src.includes("verify")) {
    ok("Integrity page has verification functionality");
  } else {
    notOk("Integrity page missing verification functionality");
  }
  if (src.includes("SHA-256") || src.includes("sha256")) {
    ok("Integrity page references SHA-256 hashing");
  } else {
    notOk("Integrity page missing SHA-256 reference");
  }
} catch (e) {
  notOk(`Integrity page read failed: ${e.message}`);
}

// ── 5. Integrity Verification Modules ───────────────────

console.log("\n5) Integrity Verification Modules");

const integrityFiles = [
  "src/lib/integrity/verifySnapshot.ts",
  "src/lib/integrity/verifyArtifactSet.ts",
];

for (const file of integrityFiles) {
  if (fileExists(file)) {
    ok(`${file.split("/").pop()} exists`);
  } else {
    notOk(`${file.split("/").pop()} does not exist`);
  }
}

try {
  const src = readFile("src/lib/integrity/verifySnapshot.ts");
  if (src.includes("verifySnapshotHash")) ok("verifySnapshot exports verifySnapshotHash");
  else notOk("verifySnapshot missing verifySnapshotHash");
  if (src.includes("verifyDropManifest")) ok("verifySnapshot exports verifyDropManifest");
  else notOk("verifySnapshot missing verifyDropManifest");
  if (src.includes("computeSnapshotHash")) ok("verifySnapshot exports computeSnapshotHash");
  else notOk("verifySnapshot missing computeSnapshotHash");
} catch (e) {
  notOk(`verifySnapshot.ts read failed: ${e.message}`);
}

try {
  const src = readFile("src/lib/integrity/verifyArtifactSet.ts");
  if (src.includes("verifyArtifactSet")) ok("verifyArtifactSet exports verifyArtifactSet");
  else notOk("verifyArtifactSet missing export");
  if (src.includes("ArtifactSetVerification")) ok("verifyArtifactSet exports result type");
  else notOk("verifyArtifactSet missing result type");
  if (src.includes("ConsistencyCheck")) ok("verifyArtifactSet exports consistency check type");
  else notOk("verifyArtifactSet missing consistency check type");
  if (src.includes("stableStringify") && src.includes("sha256")) {
    ok("verifyArtifactSet uses deterministic hashing");
  } else {
    notOk("verifyArtifactSet missing deterministic hashing");
  }
} catch (e) {
  notOk(`verifyArtifactSet.ts read failed: ${e.message}`);
}

// ── 6. Migration File ───────────────────────────────────

console.log("\n6) Database Migration");

if (fileExists("supabase/migrations/20260127_examiner_access_grants.sql")) {
  ok("Examiner access grants migration exists");
} else {
  notOk("Examiner access grants migration missing");
}

// ── Summary ─────────────────────────────────────────────

console.log(`\n=== Examiner Portal Mode: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
