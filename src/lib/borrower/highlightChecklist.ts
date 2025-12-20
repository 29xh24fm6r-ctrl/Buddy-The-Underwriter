// src/lib/borrower/highlightChecklist.ts

export type ChecklistHighlight = {
  highlightIndexes: number[]; // indexes into playbook.borrower_steps
  reason: string;             // UI hint
  docType: string | null;
  docYear: number | null;
};

function norm(s: string) {
  return (s ?? "").toLowerCase().trim();
}

function extractYear(text: string): number | null {
  const m = (text ?? "").match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/**
 * Best-effort extraction from a doc_received timeline event.
 * - title: "Bank received: Tax Return received"
 * - detail: "2023 • file.pdf"
 * - meta: { docType, docYear, fileName, source }
 */
export function parseDocHintFromEvent(input: { title?: string | null; detail?: string | null; meta?: any }) {
  const meta = input.meta ?? null;
  if (meta && typeof meta === "object") {
    const dt = typeof meta.docType === "string" ? meta.docType : null;
    const dy = typeof meta.docYear === "number" ? meta.docYear : null;
    return { docType: dt, docYear: dy };
  }

  const title = norm(input.title ?? "");
  const detail = norm(input.detail ?? "");

  let docType: string | null = null;

  if (title.includes("tax return")) docType = "Tax Return";
  else if (title.includes("personal financial statement")) docType = "Personal Financial Statement";
  else if (title.includes("financial statement")) docType = "Financial Statement";
  else if (title.includes("bank statement")) docType = "Bank Statement";
  else if (title.includes("a/r") || title.includes("accounts receivable")) docType = "A/R Aging";
  else if (title.includes("a/p") || title.includes("accounts payable")) docType = "A/P Aging";
  else if (title.includes("rent roll")) docType = "Rent Roll";
  else if (title.includes("insurance")) docType = "Insurance";

  const docYear = extractYear(detail) ?? extractYear(title);

  return { docType, docYear };
}

function keywordsForDocType(docType: string | null): string[] {
  if (!docType) return [];
  switch (docType) {
    case "Tax Return":
      return ["tax", "return", "1120", "1065", "1040", "k-1", "k1"];
    case "Personal Financial Statement":
      return ["personal", "pfs", "personal financial"];
    case "Financial Statement":
      return ["financial", "p&l", "income statement", "balance sheet", "interim"];
    case "Bank Statement":
      return ["bank statement", "bank"];
    case "A/R Aging":
      return ["a/r", "accounts receivable", "ar aging"];
    case "A/P Aging":
      return ["a/p", "accounts payable", "ap aging"];
    case "Rent Roll":
      return ["rent roll"];
    case "Insurance":
      return ["insurance"];
    default:
      return [norm(docType)];
  }
}

export function computeChecklistHighlight(args: {
  playbookSteps: string[];
  latestDocReceivedEvent?: { title?: string | null; detail?: string | null; meta?: any } | null;
}): ChecklistHighlight | null {
  const steps = args.playbookSteps ?? [];
  const latest = args.latestDocReceivedEvent ?? null;
  if (!latest || steps.length === 0) return null;

  const hint = parseDocHintFromEvent(latest);
  const kws = keywordsForDocType(hint.docType);

  if (kws.length === 0) return null;

  const hits: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = norm(steps[i]);
    if (kws.some((k) => s.includes(norm(k)))) hits.push(i);
  }

  const highlightIndexes = hits.length ? hits.slice(0, 3) : [0];

  return {
    highlightIndexes,
    reason: hint.docType
      ? `Matched your recent upload: ${hint.docType}${hint.docYear ? ` (${hint.docYear})` : ""}`
      : "Matched your recent upload",
    docType: hint.docType,
    docYear: hint.docYear,
  };
}
