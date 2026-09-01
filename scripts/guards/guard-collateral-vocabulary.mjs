#!/usr/bin/env node
/**
 * CI guard — every collateral type a producer emits has a rate entry.
 *
 * Three places assign a collateral type: the two document classifiers and the
 * banker dropdown. `DEFAULT_ADVANCE_RATES` used to be keyed by a different
 * vocabulary, so `ucc_lien`, `insurance_backed`, `purchase_target` and
 * `general` all missed it and silently took a `?? 0.50` fallback. A UCC
 * blanket lien in production was discounted at 50% instead of 70%, and that
 * number became COLLATERAL_NET_VALUE on the credit memo.
 *
 * The two vocabularies are now one union in collateralTypes.ts. This keeps
 * them one: a type introduced in a classifier or in the dropdown without a
 * corresponding entry fails the build, rather than quietly discounting a
 * borrower's collateral by a number nobody chose.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();

const CONTRACT = "src/lib/collateral/collateralTypes.ts";

/** Files that assign a collateral type, and how to read the values out. */
const PRODUCERS = [
  {
    file: "src/lib/creditMemo/inputs/prefillMemoInputs.ts",
    what: "document classifier (canonicalToType)",
    pattern: /return\s+"([a-z_]+)"\s*;/g,
    within: /function canonicalToType[\s\S]*?\n\}/,
  },
  {
    file: "src/lib/creditMemo/inputs/extractCollateralFromDocuments.ts",
    what: "document classifier (canonicalToCollateralType)",
    pattern: /return\s+"([a-z_]+)"\s*;/g,
    within: /function canonicalToCollateralType[\s\S]*?\n\}/,
  },
  {
    file: "src/components/creditMemo/inputs/CollateralItemsTable.tsx",
    what: "banker dropdown (COLLATERAL_TYPES)",
    pattern: /"([a-z_]+)"/g,
    within: /const COLLATERAL_TYPES = \[[\s\S]*?\]/,
  },
];

function read(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

// The union and the rate table, read out of the contract itself.
const contractSrc = read(CONTRACT);

const unionBlock = contractSrc.match(/export const COLLATERAL_TYPES = \[([\s\S]*?)\] as const;/);
if (!unionBlock) {
  console.error(`guard-collateral-vocabulary — could not read COLLATERAL_TYPES from ${CONTRACT}`);
  process.exit(1);
}
const declared = new Set([...unionBlock[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

const ratesBlock = contractSrc.match(
  /export const DEFAULT_ADVANCE_RATES: Record<CollateralType, number \| null> = \{([\s\S]*?)\n\};/,
);
if (!ratesBlock) {
  console.error(`guard-collateral-vocabulary — could not read DEFAULT_ADVANCE_RATES from ${CONTRACT}`);
  process.exit(1);
}
const rated = new Set([...ratesBlock[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]));

const problems = [];

// 1. Every declared type has a rate entry (null counts — it is an explicit
//    "the banker must supply this", not an omission).
for (const type of declared) {
  if (!rated.has(type)) {
    problems.push(`${CONTRACT}: "${type}" is in COLLATERAL_TYPES but has no DEFAULT_ADVANCE_RATES entry.`);
  }
}
for (const type of rated) {
  if (!declared.has(type)) {
    problems.push(`${CONTRACT}: "${type}" has a rate but is not in COLLATERAL_TYPES.`);
  }
}

// 2. Every type a producer emits is declared.
for (const producer of PRODUCERS) {
  const src = read(producer.file);
  const scope = src.match(producer.within);
  if (!scope) {
    problems.push(`${producer.file}: could not locate the ${producer.what} block — this guard needs updating.`);
    continue;
  }
  for (const m of scope[0].matchAll(producer.pattern)) {
    const type = m[1];
    if (!declared.has(type)) {
      problems.push(
        `${producer.file}: the ${producer.what} emits "${type}", which is not in COLLATERAL_TYPES.`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("guard-collateral-vocabulary — FAILED\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nAdd the type to COLLATERAL_TYPES and give it a DEFAULT_ADVANCE_RATES entry\n" +
    "(use null when this system has no defensible default and the banker must\n" +
    "supply the rate). See src/lib/collateral/collateralTypes.ts.",
  );
  process.exit(1);
}

console.log(
  `✅ guard-collateral-vocabulary passed — ${declared.size} types, all rated, all producers aligned.`,
);
