// src/app/api/deals/[dealId]/entities/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/deals/[dealId]/entities
 * List all entities for a deal
 */
async function getSupabaseClient() {
  return supabaseAdmin();
}
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const p = await ctx.params;
    const dealId = p?.dealId;

    if (!dealId) {
      return json(400, { ok: false, error: "Missing dealId" });
    }

    const supabase = await getSupabaseClient();

    if (supabase) {
      // Production: Use Supabase
      const { data, error } = await supabase
        .from("deal_entities")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[entities] GET error:", error);
        return json(500, { ok: false, error: error.message });
      }

      return json(200, { ok: true, entities: data || [] });
    } else {
      // Development: File-based fallback
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const entitiesDir = path.join(process.cwd(), ".data", "entities", dealId);

      try {
        await fs.mkdir(entitiesDir, { recursive: true });
        const files = await fs.readdir(entitiesDir);

        const entities = await Promise.all(
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

        // Ensure GROUP entity exists
        const hasGroup = entities.some((e) => e.entity_kind === "GROUP");
        if (!hasGroup) {
          const { randomUUID } = await import("crypto");
          const groupEntity = {
            id: randomUUID(),
            deal_id: dealId,
            user_id: "dev-user",
            name: "Group (Combined)",
            entity_kind: "GROUP",
            legal_name: "Combined Group Entity",
            notes: "Auto-created group entity for combined view",
            meta: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          await fs.writeFile(
            path.join(entitiesDir, `${groupEntity.id}.json`),
            JSON.stringify(groupEntity, null, 2),
            "utf-8",
          );

          entities.push(groupEntity);
        }

        entities.sort((a, b) => {
          // GROUP first, then by created_at
          if (a.entity_kind === "GROUP") return -1;
          if (b.entity_kind === "GROUP") return 1;
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        });

        return json(200, { ok: true, entities });
      } catch (e: any) {
        console.error("[entities] File read error:", e);
        return json(500, { ok: false, error: e.message });
      }
    }
  } catch (e: any) {
    console.error("[entities] GET error:", e);
    return json(500, { ok: false, error: e.message });
  }
}

/**
 * POST /api/deals/[dealId]/entities
 * Create a new entity
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

    const { name, entity_kind, legal_name, ein, ownership_percent, notes } =
      body;

    if (!name || typeof name !== "string") {
      return json(400, { ok: false, error: "Missing or invalid 'name'" });
    }

    if (
      !entity_kind ||
      !["OPCO", "PROPCO", "HOLDCO", "PERSON", "GROUP"].includes(entity_kind)
    ) {
      return json(400, { ok: false, error: "Invalid 'entity_kind'" });
    }

    const supabase = await getSupabaseClient();
    const { randomUUID } = await import("crypto");
    const entityId = randomUUID();
    const now = new Date().toISOString();

    const entity = {
      id: entityId,
      deal_id: dealId,
      user_id: "dev-user", // TODO: Replace with actual user from auth
      name,
      entity_kind,
      legal_name: legal_name || null,
      ein: ein || null,
      ownership_percent: ownership_percent || null,
      notes: notes || null,
      meta: {},
      created_at: now,
      updated_at: now,
    };

    if (supabase) {
      // Production: Use Supabase
      const { data, error } = await supabase
        .from("deal_entities")
        .insert(entity)
        .select()
        .single();

      if (error) {
        console.error("[entities] POST error:", error);
        return json(500, { ok: false, error: error.message });
      }

      return json(201, { ok: true, entity: data });
    } else {
      // Development: File-based fallback
      const fs = await import("node:fs/promises");
      const path = await import("node:path");

      const entitiesDir = path.join(process.cwd(), ".data", "entities", dealId);
      await fs.mkdir(entitiesDir, { recursive: true });

      const entityPath = path.join(entitiesDir, `${entityId}.json`);
      await fs.writeFile(entityPath, JSON.stringify(entity, null, 2), "utf-8");

      return json(201, { ok: true, entity });
    }
  } catch (e: any) {
    console.error("[entities] POST error:", e);
    return json(500, { ok: false, error: e.message });
  }
}
