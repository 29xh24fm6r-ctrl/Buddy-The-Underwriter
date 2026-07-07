// scripts/guard-nav-prefetch.mjs
// SPEC-DEAL-NAV-PREFETCH-SUPPRESSION-1
//
// Every deal page load speculatively prefetches ~20-30 sibling routes via the
// default <Link> prefetch. All targets are `dynamic = "force-dynamic"`, so each
// prefetch is a full server render whose RSC payload is stale on arrival
// (503 under concurrency, 404 under deploy skew). This guard asserts that every
// <Link> on the deal-shell + sidebar nav surfaces opts out with `prefetch={false}`.
//
// For each inventoried file: every `<Link` opening tag (parsed to its closing
// `>`, multiline-safe) must contain `prefetch={false}`. A bare <Link → exit 1
// with file:line. An explicit `// guard-allow-prefetch` on the opening-tag lines
// whitelists a legitimate exception.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Hardcoded inventory — the nav surfaces that fire prefetch on deal page load:
// the persistent shell/rail chrome AND the cockpit stage-view body (the deal
// landing redirects to /cockpit, whose primary body mounts these panels).
// Keep in sync with src/lib/navigation/__tests__/navPrefetchInvariant.test.ts.
const FILES = [
  // Persistent deal-nav chrome
  "src/app/(app)/deals/[dealId]/DealShell.tsx",
  "src/app/(app)/deals/layout.tsx",
  "src/components/nav/AppSidebar.tsx",
  "src/components/deals/DealShellMemoCta.tsx",
  // Journey rail
  "src/components/journey/StageRow.tsx",
  "src/components/journey/StageStepList.tsx",
  // Cockpit stage-view body (primary deal surface)
  "src/components/journey/stageViews/_shared/StatusListPanel.tsx",
  "src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx",
  "src/components/journey/stageViews/WorkoutStageView.tsx",
  "src/components/journey/stageViews/committee/CommitteePackagePanel.tsx",
];

const ALLOW_MARKER = "guard-allow-prefetch";

// Find each `<Link` opening tag and return { index, tag } where tag is the text
// from `<Link` through the closing `>` of the opening tag. `<Link` must be a JSX
// element open (followed by whitespace or `>`), not a substring like `<LinkFoo`.
//
// The terminating `>` is found by a brace/paren/quote-aware scan, NOT the first
// `>` — otherwise an inline arrow handler (`onClick={(e) => ...}`) or a JSX
// comparison (`{n > 0 ? ...}`) would truncate the tag before `prefetch` and
// false-positive a correctly-authored Link. A `>` only terminates the tag when
// it sits at brace/paren depth 0 and outside any string/template literal.
function findLinkOpenTags(text) {
  const tags = [];
  const re = /<Link(?=[\s/>])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    let depth = 0; // {} and () nesting inside the opening tag
    let quote = null; // active string/template delimiter: ' " `
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote && text[i - 1] !== "\\") quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{" || c === "(") depth++;
      else if (c === "}" || c === ")") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    const tag = end === -1 ? text.slice(start) : text.slice(start, end + 1);
    tags.push({ index: start, tag });
  }
  return tags;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function main() {
  const violations = [];
  const missing = [];

  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    for (const { index, tag } of findLinkOpenTags(text)) {
      if (tag.includes("prefetch={false}")) continue;
      if (tag.includes(ALLOW_MARKER)) continue;
      violations.push({ rel, line: lineOf(text, index) });
    }
  }

  if (missing.length) {
    console.error("\n❌ guard-nav-prefetch: inventoried file(s) not found — update the FILES list:\n");
    for (const rel of missing) console.error(` - ${rel}`);
    process.exit(1);
  }

  if (violations.length) {
    console.error("\n❌ <Link> without prefetch={false} on a force-dynamic deal nav surface (SPEC-DEAL-NAV-PREFETCH-SUPPRESSION-1):\n");
    for (const v of violations) {
      console.error(` - ${v.rel}:${v.line}`);
    }
    console.error(`\nFix: add prefetch={false} to the <Link> opening tag, or add a "// ${ALLOW_MARKER}" comment with rationale for a deliberate exception.\n`);
    process.exit(1);
  }

  console.log(`✅ nav-prefetch guard passed (all <Link> on ${FILES.length} deal nav surfaces opt out of prefetch).`);
}

main();
