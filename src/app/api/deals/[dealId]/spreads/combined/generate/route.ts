// src/app/api/deals/[dealId]/spreads/combined/generate/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { aggregateEntityFinancials } from "@/lib/finance/combined/aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/deals/[dealId]/spreads/combined/generate
 * Generate a combined spread across multiple entities
 *
 * Body: {
 *   entity_ids: string[];
 *   period_type: 'ANNUAL' | 'INTERIM' | 'TTM';
 *   fiscal_year?: number;
 * }
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const p = await ctx.params;
    const dealId = p?.dealId;

    if (!dealId) {
      return json(400, { ok: false, error: "Missing dealId" });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const { entity_ids, period_type = "ANNUAL", fiscal_year } = body;

    if (!entity_ids || !Array.isArray(entity_ids) || entity_ids.length === 0) {
      return json(400, {
        ok: false,
        error: "Missing or invalid entity_ids array",
      });
    }

    if (!fiscal_year) {
      return json(400, { ok: false, error: "Missing fiscal_year" });
    }

    // TODO: Replace with actual Supabase queries
    // For now, return stub response

    // In production, this would:
    // 1. Load entity_financial_periods for each entity_id + fiscal_year + period_type
    // 2. Load entity metadata (deal_entities)
    // 3. Call aggregateEntityFinancials()
    // 4. Store result in deal_combined_spreads table
    // 5. Return combined spread

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Load entities
    const entitiesDir = path.join(process.cwd(), ".data", "entities", dealId);
    let entities: any[] = [];

    try {
      const files = await fs.readdir(entitiesDir);
      entities = await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map(async (file) => {
            const content = await fs.readFile(
              path.join(entitiesDir, file),
              "utf-8",
            );
            return JSON.parse(content);
          }),
      );
    } catch (e) {
      console.error("Failed to load entities:", e);
    }

    // Filter to requested entities
    const selectedEntities = entities.filter((e) => entity_ids.includes(e.id));

    if (selectedEntities.length === 0) {
      return json(404, { ok: false, error: "No matching entities found" });
    }

    // Mock entity periods (in production, load from database)
    const mockPeriods: any[] = selectedEntities.map((entity) => ({
      id: `period-${entity.id}`,
      deal_id: dealId,
      user_id: "dev-user",
      entity_id: entity.id,
      source: "OCR",
      period_type,
      fiscal_year,
      fiscal_year_end: "12-31",
      currency: "USD",
      statement: {
        pnl: {
          revenue: 1000000 + Math.random() * 500000,
          cogs: 400000 + Math.random() * 200000,
          gross_profit: 600000,
          operating_expenses: 300000,
          operating_income: 300000,
          interest_expense: 50000,
          net_income: 250000,
        },
        balanceSheet: {
          total_assets: 2000000,
          total_liabilities: 1000000,
          total_equity: 1000000,
        },
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    // Aggregate
    const result = aggregateEntityFinancials({
      entity_periods: mockPeriods,
      entities: selectedEntities,
      fiscal_year,
      period_type,
    });

    const combinedSpread = {
      id: `combined-${Date.now()}`,
      deal_id: dealId,
      user_id: "dev-user",
      scope:
        entity_ids.length ===
        selectedEntities.filter((e) => e.entity_kind !== "GROUP").length
          ? "GROUP"
          : "SELECTED",
      entity_ids,
      period_type,
      fiscal_year,
      currency: "USD",
      combined_statement: result.combined_statement,
      flags: result.flags,
      warnings: result.flags.warnings,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // In production: save to deal_combined_spreads table

    return json(200, { ok: true, combined_spread: combinedSpread });
  } catch (e: any) {
    console.error("[combined/generate] error:", e);
    return json(500, { ok: false, error: e.message });
  }
}
