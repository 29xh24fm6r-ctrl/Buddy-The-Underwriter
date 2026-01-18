// src/buddy/exportFindings.ts
import type { BuddyFinding } from "@/buddy/findings";

export function exportFindingsAsMarkdown(findings: BuddyFinding[]) {
  const lines = findings.map((f) => {
    return [
      `## ${f.kind.toUpperCase()}${f.severity !== "n/a" ? ` (${f.severity})` : ""}`,
      f.note ? `**Note:** ${f.note}` : "",
      f.path ? `**Path:** ${f.path}` : "",
      "",
      "**Context:**",
      ...f.contextSignals.map(
        (s) => `- ${new Date(s.ts ?? Date.now()).toISOString()} · ${s.type} · ${s.source}`
      ),
      "",
    ].join("\n");
  });

  return `# Buddy Findings\n\n${lines.join("\n")}`;
}
