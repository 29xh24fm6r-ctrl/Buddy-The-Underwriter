/**
 * SPEC-DEAL-NAV-PREFETCH-SUPPRESSION-1 — source invariant.
 *
 * Every deal page load speculatively prefetches ~20-30 sibling routes via the
 * default <Link> prefetch. All targets are `dynamic = "force-dynamic"`, so each
 * prefetch is a full server render whose RSC payload is stale on arrival (503
 * under concurrency, 404 under deploy skew). This test pins that every <Link>
 * on the deal-shell + sidebar nav surfaces opts out with `prefetch={false}`.
 *
 * Duplicates scripts/guard-nav-prefetch.mjs on purpose: this fails PR CI, the
 * guard fails local `pnpm guard:all`. Keep the FILES list in sync with both.
 *
 * Lives under src/lib/navigation/__tests__ (NOT beside the app-router pages):
 * the node test runner can't resolve paths with parentheses/brackets.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = [
  // Persistent deal-nav chrome
  "src/app/(app)/deals/[dealId]/DealShell.tsx",
  "src/app/(app)/deals/layout.tsx",
  "src/components/nav/AppSidebar.tsx",
  "src/components/deals/DealShellMemoCta.tsx",
  // Journey rail
  "src/components/journey/StageRow.tsx",
  "src/components/journey/StageStepList.tsx",
  // Cockpit stage-view body (deal landing redirects to /cockpit)
  "src/components/journey/stageViews/_shared/StatusListPanel.tsx",
  "src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx",
  "src/components/journey/stageViews/WorkoutStageView.tsx",
  "src/components/journey/stageViews/committee/CommitteePackagePanel.tsx",
];

const ALLOW_MARKER = "guard-allow-prefetch";

// Each `<Link` opening tag parsed to its closing `>` (multiline-safe). `<Link`
// must open a JSX element (followed by whitespace or `>`), not `<LinkFoo`. The
// terminator is found by a brace/paren/quote-aware scan (mirrors
// scripts/guard-nav-prefetch.mjs) so a `>` inside a prop expression (an arrow
// `=>` or comparison) can't truncate the tag and false-positive a valid Link.
function findLinkOpenTags(text: string): { line: number; tag: string }[] {
  const tags: { line: number; tag: string }[] = [];
  const re = /<Link(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    let depth = 0;
    let quote: string | null = null;
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
    const line = text.slice(0, start).split("\n").length;
    tags.push({ line, tag });
  }
  return tags;
}

test("every inventoried nav file exists", () => {
  for (const rel of FILES) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `expected nav file at ${rel}`);
  }
});

test("every <Link> on deal nav surfaces sets prefetch={false}", () => {
  const violations: string[] = [];
  for (const rel of FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf-8");
    const tags = findLinkOpenTags(text);
    assert.ok(tags.length > 0, `expected at least one <Link> in ${rel}`);
    for (const { line, tag } of tags) {
      if (tag.includes("prefetch={false}")) continue;
      if (tag.includes(ALLOW_MARKER)) continue;
      violations.push(`${rel}:${line}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `<Link> missing prefetch={false} on force-dynamic deal nav surfaces:\n${violations.join("\n")}`,
  );
});
