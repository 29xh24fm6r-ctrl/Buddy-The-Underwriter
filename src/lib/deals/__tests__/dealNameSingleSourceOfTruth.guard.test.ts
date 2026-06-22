import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * SPEC-DEAL-NAME-SINGLE-SOURCE-OF-TRUTH-1 — source-level invariants.
 *
 * These guards keep the deal-name fragmentation from creeping back:
 *   1. No source file selects `legal_name` from the `deals` table (the column
 *      does not exist; selecting it throws and collapses the shell name).
 *   2. No client/component fetches the bare `/api/deals/${id}` endpoint for a
 *      name — readers must use the canonical `/api/deals/${id}/name` projection.
 *   3. The shell and the name route both derive labels from the SAME shared
 *      builder (`buildDealNameProjection`), so they can never disagree.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test fixtures/guards — they reference these tokens as data.
      if (entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(SRC);

/**
 * Extract the first string-literal argument of the `.select(` that immediately
 * follows a `.from("deals")` at `fromIdx`. Returns null when the select arg is
 * a variable (not a literal) or no nearby select exists. Then nested embeds
 * like `borrowers(...)` are stripped so only TOP-LEVEL deals columns remain —
 * a `legal_name` inside an embedded resource is legitimate and must not flag.
 */
function dealsSelectTopLevelColumns(src: string, fromIdx: number): string | null {
  const selIdx = src.indexOf(".select(", fromIdx);
  if (selIdx === -1 || selIdx - fromIdx > 400) return null;
  let i = selIdx + ".select(".length;
  while (i < src.length && /\s/.test(src[i])) i++;
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  i++;
  let buf = "";
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      buf += src[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (c === q) break;
    buf += c;
    i++;
  }
  // Strip embedded-resource groups, e.g. `borrowers(naics_code, legal_name)`.
  return buf.replace(/[A-Za-z_][\w]*\s*\([^()]*\)/g, "");
}

describe("deal-name single source of truth — source guards", () => {
  it("no source selects legal_name from the deals table", () => {
    const offenders: string[] = [];
    const fromDeals = /\.from\(\s*["'`]deals["'`]\s*\)/g;
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      fromDeals.lastIndex = 0;
      while ((m = fromDeals.exec(src))) {
        const cols = dealsSelectTopLevelColumns(src, m.index);
        if (cols && /\blegal_name\b/.test(cols)) {
          offenders.push(`${file.slice(process.cwd().length + 1)} (near index ${m.index})`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `legal_name selected from deals table in:\n${offenders.join("\n")}`,
    );
  });

  it("no client fetches the bare /api/deals/${id} endpoint (must use /name)", () => {
    const offenders: string[] = [];
    // A bare deal fetch ends the template right after the param: `/api/deals/${x}`
    // (optionally followed by a query string), with NO sub-path segment.
    const bare = /fetch\(\s*`\/api\/deals\/\$\{[^}]+\}(\?[^`]*)?`/;
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      if (bare.test(src)) {
        offenders.push(file.slice(process.cwd().length + 1));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `bare /api/deals/\${id} fetch (use /name) in:\n${offenders.join("\n")}`,
    );
  });

  it("the shell and the name route derive labels from the shared builder", () => {
    const layout = readFileSync(
      join(SRC, "app/(app)/deals/[dealId]/layout.tsx"),
      "utf8",
    );
    const nameRoute = readFileSync(
      join(SRC, "app/api/deals/[dealId]/name/route.ts"),
      "utf8",
    );
    assert.ok(
      layout.includes("buildDealNameProjection"),
      "deal shell layout must derive the name via buildDealNameProjection",
    );
    assert.ok(
      nameRoute.includes("buildDealNameProjection"),
      "name route must derive the name via buildDealNameProjection",
    );
    // And neither may reintroduce a legal_name select.
    assert.ok(!/\blegal_name\b/.test(layout), "layout must not reference legal_name");
  });
});
