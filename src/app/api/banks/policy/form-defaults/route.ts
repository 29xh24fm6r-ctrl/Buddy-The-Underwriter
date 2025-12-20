import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

/**
 * GET /api/banks/policy/form-defaults?deal_type=sba_7a&industry=restaurant
 * 
 * Get policy-compliant default values for a form.
 * 
 * Query params:
 * - deal_type: string (optional) - 'sba_7a', 'conventional', 'equipment', etc.
 * - industry: string (optional) - 'restaurant', 'retail', 'manufacturing', etc.
 * 
 * Returns:
 * {
 *   "defaults": [
 *     {
 *       "field_name": "interest_rate",
 *       "field_label": "Interest Rate",
 *       "field_type": "text",
 *       "default_value": "Prime + 2.75%",
 *       "confidence_score": 0.95,
 *       "source_text": "Standard SBA 7(a) rate is Prime + 2.75%...",
 *       "min_value": null,
 *       "max_value": null
 *     }
 *   ]
 * }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bankId = await getCurrentBankId();
    const { searchParams } = new URL(req.url);
    const dealType = searchParams.get("deal_type");
    const industry = searchParams.get("industry");

    // Fetch defaults with fallback logic:
    // 1. Exact match (deal_type + industry)
    // 2. Deal type only (industry = NULL)
    // 3. Global (both NULL)
    
    let query = supabaseAdmin()
      .from("bank_policy_defaults")
      .select("*")
      .eq("bank_id", bankId);

    // Strategy: Fetch all and filter in memory for flexibility
    const { data: allDefaults, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!allDefaults || allDefaults.length === 0) {
      return NextResponse.json({
        defaults: [],
        message: "No policy defaults found. Run extract-defaults API first.",
      });
    }

    // Filter with fallback logic
    const filteredDefaults = filterDefaultsWithFallback(
      allDefaults,
      dealType,
      industry
    );

    // Parse default_value JSON strings
    const parsedDefaults = filteredDefaults.map((d) => ({
      ...d,
      default_value: tryParseJSON(d.default_value),
    }));

    return NextResponse.json({
      defaults: parsedDefaults,
    });
  } catch (err: any) {
    console.error("[/api/banks/policy/form-defaults] Error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Filter defaults with fallback logic:
 * 1. Try exact match (deal_type + industry)
 * 2. Try deal_type only (industry = NULL)
 * 3. Try global (both NULL)
 */
function filterDefaultsWithFallback(
  defaults: any[],
  dealType: string | null,
  industry: string | null
): any[] {
  const fieldMap = new Map<string, any>();

  // Priority 3 (lowest): Global defaults (both NULL)
  for (const def of defaults) {
    if (!def.deal_type && !def.industry) {
      fieldMap.set(def.field_name, def);
    }
  }

  // Priority 2: Deal type match (industry NULL)
  if (dealType) {
    for (const def of defaults) {
      if (def.deal_type === dealType && !def.industry) {
        fieldMap.set(def.field_name, def);
      }
    }
  }

  // Priority 1 (highest): Exact match (deal_type + industry)
  if (dealType && industry) {
    for (const def of defaults) {
      if (def.deal_type === dealType && def.industry === industry) {
        fieldMap.set(def.field_name, def);
      }
    }
  }

  return Array.from(fieldMap.values());
}

/**
 * Try parsing JSON string, return original if not valid JSON
 */
function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
