// src/app/api/banker/eta-templates/route.ts
import { NextResponse } from "next/server";
import { createEtaNoteTemplate, listEtaNoteTemplates } from "@/lib/deals/etaTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal guard for now. Replace with Clerk/session check.
// You can keep this strict by requiring x-user-id.
function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function GET(req: Request) {
  try {
    requireUserId(req);
    const templates = await listEtaNoteTemplates();
    return NextResponse.json({ ok: true, templates });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = requireUserId(req);
    const body = (await req.json()) as { label: string; note: string };

    if (!body?.label?.trim()) throw new Error("Template label is required.");
    if (!body?.note?.trim()) throw new Error("Template note is required.");

    const created = await createEtaNoteTemplate({
      label: body.label.trim(),
      note: body.note.trim(),
      createdBy: userId,
    });

    return NextResponse.json({ ok: true, template: created });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 400 });
  }
}
