"use client";

/**
 * SpreadViewModelTable — renders a SpreadViewModel (from Model Engine V2)
 * using the same collapsible-section + MultiPeriodSpreadTable UI as the
 * legacy Financial Analysis page.
 *
 * PHASE 3F: Drop-in replacement when USE_MODEL_ENGINE_V2 is enabled.
 * When the flag is OFF this component is never imported/rendered.
 */

import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { MultiPeriodSpreadTable } from "@/components/deals/spreads/SpreadTable";
import type { SpreadViewModel } from "@/lib/modelEngine/renderer/types";

export function SpreadViewModelTable({ viewModel }: { viewModel: SpreadViewModel }) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  function toggleCollapse(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const periodColumns = viewModel.columns.map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
  }));

  return (
    <>
      {viewModel.sections.map((section) => {
        const isCollapsed = collapsed[section.key] ?? false;

        // Map SpreadViewRow → MultiPeriodSpreadTable row shape
        const rows = section.rows.map((r) => ({
          key: r.key,
          label: r.label,
          section: r.section,
          kind: r.kind,
          valueByCol: r.valueByCol as Record<string, string | number | null>,
          displayByCol: r.displayByCol,
          formula: r.formulaId,
        }));

        return (
          <div key={section.key} className="rounded-xl border border-white/10 bg-white/[0.02]">
            <button
              type="button"
              onClick={() => toggleCollapse(section.key)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-white">{section.label}</span>
              <Icon
                name={isCollapsed ? "chevron_right" : "chevron_left"}
                className="h-5 w-5 text-white/50"
              />
            </button>

            {!isCollapsed && rows.length > 0 && (
              <div className="border-t border-white/5">
                <MultiPeriodSpreadTable
                  title=""
                  subtitle=""
                  periodColumns={periodColumns}
                  rows={rows}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
