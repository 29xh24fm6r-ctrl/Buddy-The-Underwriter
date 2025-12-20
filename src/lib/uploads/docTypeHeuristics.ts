// src/lib/uploads/docTypeHeuristics.ts

export function inferDocTypeAndYear(fileName: string): { docType: string | null; docYear: number | null } {
  const n = fileName.toLowerCase();

  // Year
  const yearMatch = n.match(/(19|20)\d{2}/);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  // Doc type heuristics
  if (/(tax|return|1120|1065|1040|k-1|k1)/.test(n)) return { docType: "Tax Return", docYear: year };
  if (/(pfs|personal financial|financial statement personal)/.test(n)) return { docType: "Personal Financial Statement", docYear: year };
  if (/(balance sheet|p&l|income statement|profit and loss|trial balance)/.test(n)) return { docType: "Financial Statement", docYear: year };
  if (/(bank statement|stmt|statement)/.test(n) && /(bank)/.test(n)) return { docType: "Bank Statement", docYear: year };
  if (/(ar aging|accounts receivable)/.test(n)) return { docType: "A/R Aging", docYear: year };
  if (/(ap aging|accounts payable)/.test(n)) return { docType: "A/P Aging", docYear: year };
  if (/(rent roll)/.test(n)) return { docType: "Rent Roll", docYear: year };
  if (/(insurance)/.test(n)) return { docType: "Insurance", docYear: year };

  return { docType: null, docYear: year };
}
