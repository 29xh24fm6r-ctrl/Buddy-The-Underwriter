#!/usr/bin/env node

/**
 * Layout Audit Script
 *
 * Crawls src/app/(app) routes and:
 * 1. Reports routes not documented in layout-audit.md
 * 2. Detects light theme violations (bg-white, text-gray-*, etc.)
 * 3. Exits non-zero if violations found
 *
 * Usage: node scripts/layout-audit.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "src/app/(app)");
const AUDIT_DOC = join(ROOT, "docs/build-logs/layout-audit.md");

// Light theme class patterns that indicate violations
// Note: bg-white/[opacity] and text-white/[opacity] patterns are VALID dark theme (glass) patterns
// The negative lookahead (?!\/) ensures we don't flag opacity variants
const LIGHT_THEME_PATTERNS = [
  /\bbg-white(?!\/)/,  // bg-white but NOT bg-white/[opacity]
  /\btext-gray-\d+\b/,
  /\bborder-gray-\d+\b/,
  /\bbg-gray-\d+\b/,
  /\btext-neutral-\d+\b/,
  /\bborder-neutral-\d+\b/,
  /\bbg-neutral-\d+\b/,
  /\btext-slate-\d+\b/,
  /\bborder-slate-\d+\b/,
  /\bbg-slate-\d+\b/,
];

// Files/patterns to skip
const SKIP_PATTERNS = [
  /\.stitch-backup$/,
  /page-old\.tsx$/,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /__tests__/,
  /borrower\/portal/, // Borrower portal may have intentional light styling
];

/**
 * Recursively find all page.tsx files in a directory
 */
function findPageFiles(dir, files = []) {
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      findPageFiles(fullPath, files);
    } else if (entry === "page.tsx" || entry === "page.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Convert file path to route path
 */
function fileToRoute(filePath) {
  const relativePath = relative(APP_DIR, filePath);
  const route =
    "/" +
    relativePath
      .replace(/\/page\.(tsx|ts)$/, "")
      .replace(/\\/g, "/");
  return route === "/" ? "/" : route;
}

/**
 * Check if a file should be skipped
 */
function shouldSkip(filePath) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Check a file for light theme violations
 */
function checkFileForViolations(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const violations = [];

  for (const pattern of LIGHT_THEME_PATTERNS) {
    const matches = content.match(new RegExp(pattern.source, "g"));
    if (matches) {
      violations.push({
        pattern: pattern.source,
        count: matches.length,
        examples: matches.slice(0, 3),
      });
    }
  }

  return violations;
}

/**
 * Parse known routes from layout-audit.md
 */
function parseKnownRoutes() {
  if (!existsSync(AUDIT_DOC)) {
    console.warn("Warning: layout-audit.md not found");
    return new Set();
  }

  const content = readFileSync(AUDIT_DOC, "utf-8");
  const routes = new Set();

  // Parse markdown table rows for routes
  const routePattern = /\|\s*([\/\[\]a-zA-Z0-9_-]+)\s*\|/g;
  let match;
  while ((match = routePattern.exec(content)) !== null) {
    const route = match[1].trim();
    if (route.startsWith("/") && route !== "Route") {
      routes.add(route);
    }
  }

  return routes;
}

/**
 * Main audit function
 */
function runAudit() {
  console.log("Layout Audit - Stitch/Glass Theme Verification\n");
  console.log("=".repeat(60) + "\n");

  const pageFiles = findPageFiles(APP_DIR);
  const knownRoutes = parseKnownRoutes();

  let hasErrors = false;
  const violations = [];
  const undocumentedRoutes = [];

  for (const filePath of pageFiles) {
    if (shouldSkip(filePath)) continue;

    const route = fileToRoute(filePath);

    // Check if route is documented
    const isDocumented =
      knownRoutes.has(route) ||
      Array.from(knownRoutes).some((known) => {
        // Handle dynamic segments [param]
        const knownPattern = known.replace(/\[.*?\]/g, "[^/]+");
        return new RegExp(`^${knownPattern}$`).test(route);
      });

    if (!isDocumented) {
      undocumentedRoutes.push(route);
    }

    // Check for light theme violations
    const fileViolations = checkFileForViolations(filePath);
    if (fileViolations.length > 0) {
      violations.push({
        route,
        file: relative(ROOT, filePath),
        violations: fileViolations,
      });
    }
  }

  // Report undocumented routes
  if (undocumentedRoutes.length > 0) {
    console.log("UNDOCUMENTED ROUTES (not in layout-audit.md):\n");
    for (const route of undocumentedRoutes.sort()) {
      console.log(`  - ${route}`);
    }
    console.log();
    hasErrors = true;
  }

  // Report light theme violations
  if (violations.length > 0) {
    console.log("LIGHT THEME VIOLATIONS:\n");
    for (const { route, file, violations: v } of violations) {
      console.log(`  ${route}`);
      console.log(`    File: ${file}`);
      for (const { pattern, count, examples } of v) {
        console.log(`    - ${pattern}: ${count} occurrences`);
        console.log(`      Examples: ${examples.join(", ")}`);
      }
      console.log();
    }
    hasErrors = true;
  }

  // Summary
  console.log("=".repeat(60));
  console.log("\nSUMMARY:");
  console.log(`  Total routes scanned: ${pageFiles.length}`);
  console.log(`  Documented routes: ${knownRoutes.size}`);
  console.log(`  Undocumented routes: ${undocumentedRoutes.length}`);
  console.log(`  Routes with violations: ${violations.length}`);

  if (hasErrors) {
    console.log("\n[FAIL] Layout audit found issues that need attention.\n");
    process.exit(1);
  } else {
    console.log("\n[PASS] All routes are documented and using dark glass theme.\n");
    process.exit(0);
  }
}

runAudit();
