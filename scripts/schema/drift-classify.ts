import type { DriftFinding, ExpectedObject } from "./drift-detect";

export type DriftTriageClass =
  | "missing_table"
  | "dependent_on_missing_table"
  | "missing_column"
  | "missing_index"
  | "missing_function";

export type DriftClassificationItem = {
  identity: string;
  triage_class: DriftTriageClass;
  object: ExpectedObject;
  depends_on?: string;
  occurrences: Array<{
    migration_version: string;
    migration_name: string;
    source_statement: string;
  }>;
};

export type DriftClassification = {
  schema_version: 1;
  raw_findings: number;
  unique_objects: number;
  duplicate_expectations: number;
  duplicate_objects: number;
  independently_actionable_objects: number;
  by_kind: Record<ExpectedObject["kind"], number>;
  by_triage_class: Record<DriftTriageClass, number>;
  items: DriftClassificationItem[];
};

export function driftObjectIdentity(object: ExpectedObject): string {
  if (object.kind === "column") {
    return `column:${object.schema}.${object.table}.${object.name}`;
  }
  return `${object.kind}:${object.schema}.${object.name}`;
}

function parentTableIdentity(object: ExpectedObject): string | undefined {
  if (object.kind === "column") {
    return `table:${object.schema}.${object.table}`;
  }
  if (object.kind === "index" && object.table) {
    return `table:${object.table_schema ?? object.schema}.${object.table}`;
  }
  return undefined;
}

export function classifyDriftFindings(
  findings: DriftFinding[],
): DriftClassification {
  const grouped = new Map<string, DriftFinding[]>();
  for (const finding of findings) {
    const identity = driftObjectIdentity(finding.object);
    const group = grouped.get(identity);
    if (group) group.push(finding);
    else grouped.set(identity, [finding]);
  }

  const missingTables = new Set(
    [...grouped.keys()].filter((identity) => identity.startsWith("table:")),
  );

  const items: DriftClassificationItem[] = [...grouped.entries()]
    .map(([identity, occurrences]) => {
      const object = occurrences[0].object;
      const parent = parentTableIdentity(object);
      const dependsOn = parent && missingTables.has(parent) ? parent : undefined;
      const triageClass: DriftTriageClass = dependsOn
        ? "dependent_on_missing_table"
        : object.kind === "table"
          ? "missing_table"
          : object.kind === "column"
            ? "missing_column"
            : object.kind === "index"
              ? "missing_index"
              : "missing_function";

      return {
        identity,
        triage_class: triageClass,
        object,
        ...(dependsOn ? { depends_on: dependsOn } : {}),
        occurrences: occurrences
          .map((finding) => ({
            migration_version: finding.migration_version,
            migration_name: finding.migration_name,
            source_statement: finding.source_statement,
          }))
          .sort((a, b) =>
            `${a.migration_version}:${a.migration_name}`.localeCompare(
              `${b.migration_version}:${b.migration_name}`,
            ),
          ),
      };
    })
    .sort((a, b) => a.identity.localeCompare(b.identity));

  const byKind: DriftClassification["by_kind"] = {
    table: 0,
    column: 0,
    index: 0,
    function: 0,
  };
  const byClass: DriftClassification["by_triage_class"] = {
    missing_table: 0,
    dependent_on_missing_table: 0,
    missing_column: 0,
    missing_index: 0,
    missing_function: 0,
  };
  for (const item of items) {
    byKind[item.object.kind] += 1;
    byClass[item.triage_class] += 1;
  }

  return {
    schema_version: 1,
    raw_findings: findings.length,
    unique_objects: items.length,
    duplicate_expectations: findings.length - items.length,
    duplicate_objects: items.filter((item) => item.occurrences.length > 1).length,
    independently_actionable_objects:
      items.length - byClass.dependent_on_missing_table,
    by_kind: byKind,
    by_triage_class: byClass,
    items,
  };
}
