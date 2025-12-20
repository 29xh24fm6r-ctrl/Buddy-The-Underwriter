// src/lib/sba/sync.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

type SBASource = {
  sourceKey: string;
  title: string;
  url: string;
  publishedDate: string | null;
  effectiveDate: string | null;
};

/**
 * Sync SBA sources (SOP documents, forms metadata)
 * In production, this would fetch from SBA.gov
 * For now, we seed with known metadata
 */
export async function syncSBASources() {
  const sb = supabaseAdmin();

  const sources: SBASource[] = [
    {
      sourceKey: "SOP_50_10",
      title: "SOP 50 10 - Lender and Development Company Loan Programs",
      url: "https://www.sba.gov/document/sop-50-10-lender-development-company-loan-programs",
      publishedDate: "2025-04-01",
      effectiveDate: "2025-06-01",
    },
    {
      sourceKey: "FORM_413",
      title: "SBA Form 413 - Personal Financial Statement",
      url: "https://www.sba.gov/document/sba-form-413-personal-financial-statement",
      publishedDate: "2024-01-01",
      effectiveDate: "2024-01-01",
    },
    {
      sourceKey: "FORM_148",
      title: "SBA Form 148 - Unconditional Guarantee",
      url: "https://www.sba.gov/document/sba-form-148-unconditional-guarantee",
      publishedDate: "2024-01-01",
      effectiveDate: "2024-01-01",
    },
  ];

  for (const src of sources) {
    await sb.from("sba_sources").upsert(
      {
        source_key: src.sourceKey,
        title: src.title,
        url: src.url,
        published_date: src.publishedDate,
        effective_date: src.effectiveDate,
        last_fetched_at: new Date().toISOString(),
      },
      { onConflict: "source_key" }
    );
  }

  return sources;
}

/**
 * Sync SBA rule index (canonical rules extracted from SOPs/forms)
 */
export async function syncSBARuleIndex() {
  const sb = supabaseAdmin();

  // Get source IDs
  const { data: sources } = await sb.from("sba_sources").select("id, source_key");
  const sourceMap = new Map((sources ?? []).map((s: any) => [s.source_key, s.id]));

  const sopId = sourceMap.get("SOP_50_10");
  const form148Id = sourceMap.get("FORM_148");
  const form413Id = sourceMap.get("FORM_413");

  if (!sopId || !form148Id || !form413Id) {
    throw new Error("SBA sources not found. Run syncSBASources first.");
  }

  const rules = [
    {
      source_id: form148Id,
      rule_key: "GUARANTY_20PCT",
      summary: "Individuals owning 20% or more of a business must provide unlimited personal guaranty (SBA Form 148)",
      details: {
        threshold: 20,
        formRequired: "SBA Form 148",
        appliesToPrograms: ["7(a)", "504"],
        citation: "SBA Form 148 instructions",
      },
    },
    {
      source_id: form413Id,
      rule_key: "PFS_REQUIRED",
      summary: "Personal Financial Statement (SBA Form 413) required for all 20%+ owners",
      details: {
        formRequired: "SBA Form 413",
        appliesToPrograms: ["7(a)", "504"],
        citation: "SBA SOP 50 10",
      },
    },
    {
      source_id: sopId,
      rule_key: "PERSONAL_TAX_3YR",
      summary: "Three years of personal tax returns required for all 20%+ owners",
      details: {
        yearsRequired: 3,
        appliesToPrograms: ["7(a)", "504"],
        citation: "SBA SOP 50 10",
      },
    },
  ];

  for (const r of rules) {
    await sb.from("sba_rule_index").upsert(r, { onConflict: "source_id,rule_key" });
  }

  return rules;
}

/**
 * Get current SBA rule by key (for Buddy answers)
 */
export async function getSBARuleByKey(ruleKey: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("sba_rule_index")
    .select(`
      *,
      source:sba_sources(source_key, title, url, published_date, effective_date)
    `)
    .eq("rule_key", ruleKey)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Combined sync core function (sources + rules)
 */
export async function sbaSyncCore() {
  const sources = await syncSBASources();
  const rules = await syncSBARuleIndex();
  return { ok: true, sources: sources.length, rules: rules.length };
}

/**
 * Get SBA sync status
 */
export async function sbaStatus() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("sba_sources")
    .select("source_key,title,url,last_fetched_at,published_date,effective_date")
    .order("source_key", { ascending: true });

  if (error) throw error;
  return { ok: true, sources: data ?? [] };
}
