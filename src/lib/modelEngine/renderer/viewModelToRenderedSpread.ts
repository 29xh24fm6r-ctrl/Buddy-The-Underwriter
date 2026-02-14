/**
 * viewModelToRenderedSpread — Pure Structural Adapter
 *
 * Converts V2 SpreadViewModel → V1 RenderedSpread shape for the print HTML engine.
 * ZERO business logic. Pure structural transformation only.
 */

import type { SpreadViewModel } from "./types";
import type { RenderedSpread, SpreadColumnV2 } from "@/lib/financialSpreads/types";

export function viewModelToRenderedSpread(vm: SpreadViewModel): RenderedSpread {
  const columnsV2: SpreadColumnV2[] = vm.columns.map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind as any,
  }));

  const rows: RenderedSpread["rows"] = [];
  for (const section of vm.sections) {
    rows.push({
      key: `_header_${section.key}`,
      label: section.label,
      values: [],
      notes: "section_header",
    });
    for (const row of section.rows) {
      rows.push({
        key: row.key,
        label: row.label,
        section: row.section,
        values: [
          {
            value: null,
            valueByCol: row.valueByCol,
            displayByCol: row.displayByCol,
            formula_ref: row.formulaId,
          },
        ],
        formula: row.formulaId,
      });
    }
  }

  return {
    schema_version: 3,
    title: "Financial Analysis",
    spread_type: "STANDARD",
    generatedAt: vm.generatedAt,
    columns: columnsV2.map((c) => c.label),
    columnsV2,
    rows,
    meta: {
      row_count: vm.meta.rowCount,
      period_count: vm.meta.periodCount,
      source: "v2_viewmodel_adapter",
    },
  };
}
