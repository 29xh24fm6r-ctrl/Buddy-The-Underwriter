// Pure deep-diff between two Florida Armory memo snapshots.
//
// Reads ONLY memo_output_json. Computes structural differences and
// classifies each change by severity based on the section path.

import type {
  IntelligenceSnapshotRow,
  MemoDiffSeverity,
  MemoFieldChange,
  MemoSectionDiff,
  MemoVersionDiff,
} from "./types";

// Sections that drive credit decisions. Any change in these sections is
// material — the underwriter must look at it.
const MATERIAL_PATHS: readonly string[] = [
  "sections.financing_request",
  "sections.debt_coverage",
  "sections.global_cash_flow",
  "sections.collateral",
  "sections.management_qualifications",
  "sections.policy_exceptions",
  "sections.recommendation_approval",
];

export function severityForPath(path: string): MemoDiffSeverity {
  if (MATERIAL_PATHS.some((p) => path.startsWith(p))) return "material";
  if (path.includes("narrative") || path.includes("tables")) return "moderate";
  return "minor";
}

// Stable JSON: sorts object keys at every depth so equivalent objects
// with different key orderings hash to identical strings. Used to
// short-circuit the diff when subtrees are equal.
export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
    .join(",")}}`;
}

function labelFromPath(path: string): string {
  const parts = path.split(".");
  if (parts.length <= 1) return path;
  return parts.slice(-2).join(" → ");
}

function diffObjects(
  before: unknown,
  after: unknown,
  basePath = "",
): MemoFieldChange[] {
  const changes: MemoFieldChange[] = [];

  // Both undefined or equal — nothing to report.
  if (stableJson(before) === stableJson(after)) return changes;

  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  // Recurse into plain objects so we get path-level granularity.
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const path = basePath ? `${basePath}.${key}` : key;
      const b = before[key];
      const a = after[key];
      if (stableJson(b) === stableJson(a)) continue;
      changes.push(...diffObjects(b, a, path));
    }
    return changes;
  }

  // Leaf change (primitive, array, or shape mismatch).
  changes.push({
    path: basePath,
    label: labelFromPath(basePath),
    before: before ?? null,
    after: after ?? null,
    severity: severityForPath(basePath),
  });
  return changes;
}

type FloridaSnapshot = {
  sections?: Record<string, { title?: string }> | undefined;
  [k: string]: unknown;
};

function readMemo(row: IntelligenceSnapshotRow): FloridaSnapshot {
  const m = row.memo_output_json;
  return m && typeof m === "object" ? (m as FloridaSnapshot) : {};
}

export function diffSnapshots(
  beforeSnapshot: IntelligenceSnapshotRow,
  afterSnapshot: IntelligenceSnapshotRow,
): MemoVersionDiff {
  const beforeMemo = readMemo(beforeSnapshot);
  const afterMemo = readMemo(afterSnapshot);

  const beforeSections = beforeMemo.sections ?? {};
  const afterSections = afterMemo.sections ?? {};

  // Diff over the union of section keys so additions and removals are
  // both surfaced.
  const sectionKeys = new Set([
    ...Object.keys(beforeSections),
    ...Object.keys(afterSections),
  ]);

  const changed_sections: MemoSectionDiff[] = [];
  for (const sectionKey of sectionKeys) {
    const beforeSection = (beforeSections as any)[sectionKey];
    const afterSection = (afterSections as any)[sectionKey];
    const changes = diffObjects(
      beforeSection,
      afterSection,
      `sections.${sectionKey}`,
    );
    const title =
      (afterSection?.title as string | undefined) ??
      (beforeSection?.title as string | undefined) ??
      sectionKey;
    changed_sections.push({
      section_key: sectionKey,
      section_title: title,
      changed: changes.length > 0,
      changes,
    });
  }

  const onlyChanged = changed_sections.filter((s) => s.changed);
  const material_changes = onlyChanged
    .flatMap((s) => s.changes)
    .filter((c) => c.severity === "material");

  const summary =
    onlyChanged.length === 0
      ? "No changes detected between submitted versions."
      : material_changes.length > 0
        ? `${material_changes.length} material change${material_changes.length === 1 ? "" : "s"} across ${onlyChanged.length} section${onlyChanged.length === 1 ? "" : "s"}.`
        : `${onlyChanged.length} section${onlyChanged.length === 1 ? "" : "s"} changed (no material changes).`;

  return {
    from_snapshot_id: beforeSnapshot.id,
    to_snapshot_id: afterSnapshot.id,
    from_version: beforeSnapshot.memo_version,
    to_version: afterSnapshot.memo_version,
    changed_sections: onlyChanged,
    material_changes,
    summary,
  };
}
