import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeBuilderCanonical } from "@/lib/builder/builderCanonicalWrite";
import { writeEvent } from "@/lib/ledger/writeEvent";
import type { BuilderSectionKey } from "@/lib/builder/builderTypes";

export const runtime = "nodejs";
export const maxDuration = 10;

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_KEYS: BuilderSectionKey[] = [
  "deal", "business", "parties", "guarantors", "structure", "story",
];

export async function GET(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: rows, error } = await sb
    .from("deal_builder_sections")
    .select("section_key, data, updated_at")
    .eq("deal_id", dealId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sections: Record<string, { data: unknown; updated_at: string }> = {};
  for (const row of rows ?? []) {
    sections[row.section_key] = { data: row.data, updated_at: row.updated_at };
  }

  return NextResponse.json({ sections });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const { section_key, data } = body as {
    section_key: string;
    data: Record<string, unknown>;
  };

  if (!section_key || !VALID_KEYS.includes(section_key as BuilderSectionKey)) {
    return NextResponse.json({ error: "Invalid section_key" }, { status: 400 });
  }
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  // Upsert ON CONFLICT (deal_id, section_key)
  const { error } = await sb
    .from("deal_builder_sections")
    .upsert(
      {
        deal_id: dealId,
        section_key,
        data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,section_key" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fire canonical write-through (non-fatal)
  writeBuilderCanonical(dealId, section_key as BuilderSectionKey, data, sb).catch(
    (err) =>
      console.error("[builder/sections] canonical write failed", {
        dealId,
        section_key,
        error: err?.message,
      }),
  );

  // Fire ledger event (best-effort, fire-and-forget)
  writeEvent({
    dealId,
    kind: "builder.section_updated",
    scope: "builder",
    action: `section.${section_key}`,
    input: { section_key },
  }).catch(() => {});

  return NextResponse.json({ ok: true, updated_at: new Date().toISOString() });
}
