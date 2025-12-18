// src/app/api/deals/[dealId]/entities/[entityId]/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { 
  params: Promise<{ dealId: string; entityId: string }> | { dealId: string; entityId: string } 
};

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

async function getSupabaseClient(): Promise<any> {
  // Stub: Replace with your actual Supabase initialization
  return null;
}

/**
 * GET /api/deals/[dealId]/entities/[entityId]
 * Get single entity
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const { dealId, entityId } = p;

    if (!dealId || !entityId) {
      return json(400, { ok: false, error: "Missing dealId or entityId" });
    }

    const supabase = await getSupabaseClient();
    
    if (supabase) {
      const { data, error } = await supabase
        .from('deal_entities')
        .select('*')
        .eq('id', entityId)
        .eq('deal_id', dealId)
        .single();

      if (error) {
        return json(404, { ok: false, error: 'Entity not found' });
      }

      return json(200, { ok: true, entity: data });
    } else {
      // File-based fallback
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      
      const entityPath = path.join(process.cwd(), ".data", "entities", dealId, `${entityId}.json`);
      
      try {
        const content = await fs.readFile(entityPath, 'utf-8');
        const entity = JSON.parse(content);
        return json(200, { ok: true, entity });
      } catch {
        return json(404, { ok: false, error: 'Entity not found' });
      }
    }
  } catch (e: any) {
    console.error('[entity] GET error:', e);
    return json(500, { ok: false, error: e.message });
  }
}

/**
 * PATCH /api/deals/[dealId]/entities/[entityId]
 * Update entity fields
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const { dealId, entityId } = p;

    if (!dealId || !entityId) {
      return json(400, { ok: false, error: "Missing dealId or entityId" });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const allowedFields = ['name', 'entity_kind', 'legal_name', 'ein', 'ownership_percent', 'notes', 'meta'];
    const updates: any = {};

    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return json(400, { ok: false, error: 'No valid fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    const supabase = await getSupabaseClient();
    
    if (supabase) {
      const { data, error } = await supabase
        .from('deal_entities')
        .update(updates)
        .eq('id', entityId)
        .eq('deal_id', dealId)
        .select()
        .single();

      if (error) {
        return json(404, { ok: false, error: 'Entity not found' });
      }

      return json(200, { ok: true, entity: data });
    } else {
      // File-based fallback
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      
      const entityPath = path.join(process.cwd(), ".data", "entities", dealId, `${entityId}.json`);
      
      try {
        const content = await fs.readFile(entityPath, 'utf-8');
        const entity = JSON.parse(content);
        
        const updatedEntity = { ...entity, ...updates };
        
        await fs.writeFile(entityPath, JSON.stringify(updatedEntity, null, 2), 'utf-8');
        
        return json(200, { ok: true, entity: updatedEntity });
      } catch {
        return json(404, { ok: false, error: 'Entity not found' });
      }
    }
  } catch (e: any) {
    console.error('[entity] PATCH error:', e);
    return json(500, { ok: false, error: e.message });
  }
}

/**
 * DELETE /api/deals/[dealId]/entities/[entityId]
 * Delete entity (sets pack_items.entity_id to null via cascade)
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const { dealId, entityId } = p;

    if (!dealId || !entityId) {
      return json(400, { ok: false, error: "Missing dealId or entityId" });
    }

    const supabase = await getSupabaseClient();
    
    if (supabase) {
      const { error } = await supabase
        .from('deal_entities')
        .delete()
        .eq('id', entityId)
        .eq('deal_id', dealId);

      if (error) {
        return json(404, { ok: false, error: 'Entity not found' });
      }

      return json(200, { ok: true, deleted: true });
    } else {
      // File-based fallback
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      
      const entityPath = path.join(process.cwd(), ".data", "entities", dealId, `${entityId}.json`);
      
      try {
        await fs.unlink(entityPath);
        return json(200, { ok: true, deleted: true });
      } catch {
        return json(404, { ok: false, error: 'Entity not found' });
      }
    }
  } catch (e: any) {
    console.error('[entity] DELETE error:', e);
    return json(500, { ok: false, error: e.message });
  }
}
