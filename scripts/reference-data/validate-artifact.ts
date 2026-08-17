/**
 * Validates the generated SBA reference artifact using the SAME validator
 * the runtime loader uses. Invoked by guard-reference-dataset-coverage.mjs,
 * which is plain .mjs and cannot import TypeScript directly.
 *
 * Exists so the guard can never "pass" by checking something weaker than
 * production does.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateDataset } from "../../src/lib/reference/sba/validateDataset";

const path = resolve(process.cwd(), "data/reference/sba-size-standards.json");
const dataset = JSON.parse(readFileSync(path, "utf8"));
const issues = validateDataset(dataset);
const errors = issues.filter((i) => i.severity === "error");

for (const issue of issues) {
  console.log(`${issue.severity.toUpperCase()}|${issue.code}|${issue.message}`);
}
process.exit(errors.length > 0 ? 1 : 0);
