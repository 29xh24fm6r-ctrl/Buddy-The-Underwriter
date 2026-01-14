// src/app/api/admin/schema/activate-doc-text/route.ts
import { NextResponse } from "next/server";
import {
  activateDocTextSource,
  discoverSchema,
} from "@/lib/admin/schemaDiscovery";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin endpoint: activate doc text source mapping
 *
 * Modes:
 * - Explicit: provide tableName + textColumn + optional metadata columns
 * - Auto-pick: no body → discovers and activates top candidate automatically
 */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin();
    const body = await req.json().catch(() => ({}));
    const explicitTable = body?.tableName ? String(body.tableName) : null;
    const explicitCol = body?.textColumn ? String(body.textColumn) : null;

    // If explicit mapping given, use it
    if (explicitTable && explicitCol) {
      const row = await activateDocTextSource({
        tableName: explicitTable,
        textColumn: explicitCol,
        dealIdColumn: body?.dealIdColumn ? String(body.dealIdColumn) : null,
        documentIdColumn: body?.documentIdColumn
          ? String(body.documentIdColumn)
          : null,
        labelColumn: body?.labelColumn ? String(body.labelColumn) : null,
        updatedAtColumn: body?.updatedAtColumn
          ? String(body.updatedAtColumn)
          : null,
      });
      return NextResponse.json({ ok: true, active: row });
    }

    // Otherwise auto-pick top candidate and assume common column names
    const disc = await discoverSchema();
    const top = disc.docText?.[0];
    if (!top) throw new Error("No doc text candidates found.");

    const row = await activateDocTextSource({
      tableName: top.table,
      textColumn: top.column,
      dealIdColumn: "deal_id",
      documentIdColumn: "document_id",
      labelColumn: "doc_label",
      updatedAtColumn: "updated_at",
    });

    return NextResponse.json({ ok: true, active: row, autoPicked: top });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg === "unauthorized") return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (msg === "forbidden") return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    return NextResponse.json(
      { ok: false, error: msg || "Unknown error" },
      { status: 500 },
    );
  }
}
