import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> | { dealId: string } };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const p = params instanceof Promise ? await params : params;
    const dealId = p?.dealId;

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "Missing dealId" }, { status: 400 });
    }

    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const dir = path.join("/tmp/buddy_uploads", dealId);

    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      names = [];
    }

    // Return newest-first
    const files = await Promise.all(
      names.map(async (name) => {
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        return {
          stored_name: name,
          size: st.size,
          uploaded_at: st.mtime.toISOString(),
        };
      })
    );

    files.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));

    return NextResponse.json({ ok: true, deal_id: dealId, files });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
