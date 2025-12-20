// src/lib/portal/evidence.ts
// Shared helpers for evidence extraction and document classification

function norm(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function tokens(s: string) {
  return norm(s).split(" ").filter((t) => t.length >= 3);
}

export function detectYearFromText(s: string): number | null {
  const m = (s || "").match(/\b(20[0-3][0-9])\b/); // 2000-2039
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y)) return null;
  return y;
}

export function normalizeDocType(dt?: string | null): string | null {
  if (!dt) return null;
  const x = norm(dt);

  if (x.includes("tax")) return "tax_return";
  if (x.includes("pfs") || x.includes("personal financial")) return "pfs";
  if (x.includes("bank statement")) return "bank_statement";
  if (x.includes("rent roll")) return "rent_roll";
  if (x.includes("operating statement") || x.includes("t12") || x.includes("trailing")) return "operating_statement";
  if (x.includes("balance sheet")) return "balance_sheet";
  if (x.includes("income statement") || x.includes("profit") || x.includes("p l")) return "income_statement";
  if (x.includes("insurance")) return "insurance";
  if (x.includes("debt schedule")) return "debt_schedule";
  if (x.includes("accounts receivable") || x === "ar") return "ar_aging";
  if (x.includes("accounts payable") || x === "ap") return "ap_aging";

  return x.replace(/\s+/g, "_") || null;
}

export function uniqStrings(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const v = (x || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export type Evidence = {
  source: string;
  docType?: string | null;
  year?: number | null;
  keywords?: string[];
  entities?: string[];
  raw?: any;
};

/**
 * Best-effort evidence lookup.
 * Safe behavior: if tables/columns don't exist or any query fails, return null.
 */
export async function loadEvidenceForUpload(sb: any, upload: any): Promise<Evidence | null> {
  // Attempt 1: document_job_results where entity_type='borrower_upload' and entity_id=upload.id
  try {
    const r1 = await sb
      .from("document_job_results")
      .select("id, created_at, payload, entity_type, entity_id")
      .eq("entity_type", "borrower_upload")
      .eq("entity_id", upload.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!r1.error && r1.data && r1.data[0]) {
      const payload = r1.data[0].payload || {};
      const docType =
        payload.doc_type ||
        payload.document_type ||
        payload.classification?.doc_type ||
        payload.classify?.doc_type ||
        null;

      const year =
        payload.year ||
        payload.tax_year ||
        payload.classification?.year ||
        payload.classify?.year ||
        detectYearFromText(JSON.stringify(payload).slice(0, 5000));

      const keywords =
        payload.keywords ||
        payload.classification?.keywords ||
        payload.classify?.keywords ||
        payload.summary_keywords ||
        [];

      const entities =
        payload.entities ||
        payload.classification?.entities ||
        payload.classify?.entities ||
        [];

      return {
        source: "document_job_results:entity",
        docType: docType ?? null,
        year: year ? Number(year) : null,
        keywords: Array.isArray(keywords) ? keywords.slice(0, 50) : [],
        entities: Array.isArray(entities) ? entities.slice(0, 20) : [],
        raw: { doc_type: docType ?? null, year: year ? Number(year) : null },
      };
    }
  } catch {
    // ignore
  }

  // Attempt 2: legacy document_results table
  try {
    const r2 = await sb
      .from("document_results")
      .select("id, created_at, payload, entity_type, entity_id")
      .eq("entity_type", "borrower_upload")
      .eq("entity_id", upload.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (!r2.error && r2.data && r2.data[0]) {
      const payload = r2.data[0].payload || {};
      const docType = payload.doc_type || payload.document_type || payload.classification?.doc_type || null;
      const year = payload.year || payload.tax_year || payload.classification?.year || detectYearFromText(JSON.stringify(payload).slice(0, 5000));
      const keywords = payload.keywords || payload.classification?.keywords || [];
      const entities = payload.entities || payload.classification?.entities || [];

      return {
        source: "document_results:entity",
        docType: docType ?? null,
        year: year ? Number(year) : null,
        keywords: Array.isArray(keywords) ? keywords.slice(0, 50) : [],
        entities: Array.isArray(entities) ? entities.slice(0, 20) : [],
        raw: { doc_type: docType ?? null, year: year ? Number(year) : null },
      };
    }
  } catch {
    // ignore
  }

  return null;
}
