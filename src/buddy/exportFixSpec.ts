// src/buddy/exportFixSpec.ts
import type { BuddyFinding } from "@/buddy/findings";
import { getDealIdFromPath } from "@/buddy/getDealIdFromPath";

export function exportFixSpecForFinding(f: BuddyFinding) {
  const dealId = typeof f.path === "string" ? getDealIdFromPath(f.path) : null;

  const ctx = (f.contextSignals ?? [])
    .slice(0, 20)
    .map((s: any) => `- ${s.type ?? "signal"} · ${s.source ?? ""}`)
    .join("\n");

  return [
    `# Cursor Fix Spec — Buddy Finding`,
    ``,
    `Finding: ${f.kind.toUpperCase()}${f.severity !== "n/a" ? ` (${f.severity})` : ""}`,
    f.note ? `Note: ${f.note}` : `Note: (none)`,
    f.path ? `Path: ${f.path}` : `Path: (unknown)`,
    dealId ? `DealId: ${dealId}` : ``,
    ``,
    `## Goal`,
    `Fix the issue described above. Preserve existing behavior outside this flow.`,
    ``,
    `## Repro Steps (fill in if missing)`,
    `1) ...`,
    `2) ...`,
    ``,
    `## Expected vs Actual`,
    `- Expected: ...`,
    `- Actual: ...`,
    ``,
    `## Suspected Area`,
    `- Files likely involved: (fill in)`,
    ``,
    `## Context Signals`,
    ctx || `- (none captured)`,
    ``,
    `## Implementation Plan`,
    `- [ ] Add/adjust server route logic (if needed)`,
    `- [ ] Add/adjust client wiring (CTA, navigation, state refresh)`,
    `- [ ] Add regression check (typecheck/lint at minimum)`,
    ``,
    `## Commands`,
    `\`\`\`bash`,
    `pnpm -s typecheck`,
    `pnpm -s lint`,
    `\`\`\``,
    ``,
  ]
    .filter(Boolean)
    .join("\n");
}
