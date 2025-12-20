"use client";

import React, { useMemo } from "react";
import { LOAN_KNOWLEDGE } from "@/lib/interview/loanKnowledge";

type Fact = {
  id: string;
  field_key: string;
  confirmed: boolean;
  field_value: any;
};

interface BorrowerHelpCenterCardProps {
  facts: Fact[];
  onOpenQa: () => void;
}

/**
 * STEP 12: Dynamic Help Center
 * Shows relevant knowledge chunks based on loan type + "Ask a question" button
 */
export function BorrowerHelpCenterCard({
  facts,
  onOpenQa,
}: BorrowerHelpCenterCardProps) {
  const loanTypeRequested = useMemo(() => {
    const f = facts.find((x) => x.confirmed && x.field_key === "loan_type_requested");
    return f?.field_value ?? null;
  }, [facts]);

  const helpChunkIds = pickHelpChunkIds(loanTypeRequested);
  const chunks = LOAN_KNOWLEDGE.filter((c) => helpChunkIds.includes(c.id));

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
      <div className="mb-3">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span>📚</span>
          <span>Help Center</span>
        </div>
      </div>

      <div className="space-y-4">
        {chunks.length > 0 ? (
          <div className="space-y-3">
            {chunks.map((chunk) => (
              <div key={chunk.id} className="text-sm">
                <h4 className="font-semibold text-gray-900 mb-1">
                  {chunk.title}
                </h4>
                <p className="text-gray-700 leading-relaxed">{chunk.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            We'll show relevant help topics once we know your loan type.
          </p>
        )}

        <button
          onClick={onOpenQa}
          className="w-full rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <span>❓</span>
            <span>Ask a question</span>
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Pick which knowledge chunks to show based on loan type
 */
function pickHelpChunkIds(loanType?: string): string[] {
  if (!loanType) {
    return ["overview_loan_types", "disclaimer"];
  }

  const type = loanType.toUpperCase();
  const base: string[] = [];

  // Add loan-type specific chunks
  if (type.includes("SBA") && type.includes("7")) {
    base.push("sba_7a_basics");
  }
  if (type.includes("SBA") && type.includes("504")) {
    base.push("sba_504_basics");
  }
  if (type.includes("CRE") || type.includes("COMMERCIAL REAL ESTATE")) {
    base.push("cre_basics");
  }
  if (type.includes("LOC") || type.includes("LINE OF CREDIT")) {
    base.push("loc_basics");
  }
  if (type.includes("TERM")) {
    base.push("term_basics");
  }
  if (type.includes("EQUIPMENT")) {
    base.push("equipment_basics");
  }

  // Add common docs chunk
  base.push("docs_common");

  // Always add disclaimer
  base.push("disclaimer");

  return base;
}
