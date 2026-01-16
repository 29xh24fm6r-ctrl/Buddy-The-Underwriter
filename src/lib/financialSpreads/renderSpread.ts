import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSpreadTemplate } from "@/lib/financialSpreads/templates";
import type { RenderedSpread, SpreadType } from "@/lib/financialSpreads/types";

function emptyErrorSpread(type: SpreadType, message: string): RenderedSpread {
  return {
    title: type,
    spread_type: type,
    status: "error",
    generatedAt: new Date().toISOString(),
    asOf: null,
    columns: ["Line Item", "Value"],
    rows: [
      {
        key: "error",
        label: "Template missing",
        values: [message, null],
        notes: "Upload the PDF template so we can match layout/calcs exactly.",
      },
    ],
    meta: { error: message },
  };
}

export async function renderSpread(args: {
  dealId: string;
  bankId: string;
  spreadType: SpreadType;
}) {
  const sb = supabaseAdmin();

  const template = getSpreadTemplate(args.spreadType);
  if (!template) {
    const rendered = emptyErrorSpread(
      args.spreadType,
      `No template registered for ${args.spreadType}`,
    );

    const { error } = await (sb as any)
      .from("deal_spreads")
      .upsert(
        {
          deal_id: args.dealId,
          bank_id: args.bankId,
          spread_type: args.spreadType,
          spread_version: 1,
          status: "error",
          inputs_hash: null,
          rendered_json: rendered,
          rendered_html: null,
          rendered_csv: null,
          error: rendered.meta?.error ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,bank_id,spread_type,spread_version" } as any,
      );

    if (error) throw new Error(`deal_spreads_upsert_failed:${error.message}`);

    return { ok: false as const, error: rendered.meta?.error ?? "template_missing" };
  }

  const factsRes = await (sb as any)
    .from("deal_financial_facts")
    .select("*")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId);

  if (factsRes.error) {
    throw new Error(`deal_financial_facts_select_failed:${factsRes.error.message}`);
  }

  const renderedBase = template.render({
    dealId: args.dealId,
    bankId: args.bankId,
    facts: (factsRes.data ?? []) as any,
  });

  const rendered: RenderedSpread = {
    ...(renderedBase as any),
    spread_type: args.spreadType,
    status: "ready",
    generatedAt: new Date().toISOString(),
  };

  const { error } = await (sb as any)
    .from("deal_spreads")
    .upsert(
      {
        deal_id: args.dealId,
        bank_id: args.bankId,
        spread_type: args.spreadType,
        spread_version: template.version,
        status: "ready",
        inputs_hash: null,
        rendered_json: rendered,
        rendered_html: null,
        rendered_csv: null,
        error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,bank_id,spread_type,spread_version" } as any,
    );

  if (error) throw new Error(`deal_spreads_upsert_failed:${error.message}`);

  return { ok: true as const };
}
