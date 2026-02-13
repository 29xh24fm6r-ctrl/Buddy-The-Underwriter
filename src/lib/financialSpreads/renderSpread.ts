import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSpreadTemplate } from "@/lib/financialSpreads/templates";
import { SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { reconcileAegisFindingsForSpread } from "@/lib/aegis/reconcileSpreadFindings";
import type { RenderedSpread, RentRollRow, SpreadType } from "@/lib/financialSpreads/types";

function emptyErrorSpread(type: SpreadType, message: string): RenderedSpread {
  return {
    schema_version: 1,
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
        values: [message],
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
  ownerType?: string;
  ownerEntityId?: string | null;
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
          owner_type: args.ownerType ?? "DEAL",
          owner_entity_id: args.ownerEntityId ?? SENTINEL_UUID,
          status: "error",
          inputs_hash: null,
          rendered_json: rendered,
          rendered_html: null,
          rendered_csv: null,
          error: rendered.meta?.error ?? null,
          error_code: "TEMPLATE_NOT_FOUND",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
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

  let rentRollRows: RentRollRow[] | undefined = undefined;
  if (args.spreadType === "RENT_ROLL") {
    const rrRes = await (sb as any)
      .from("deal_rent_roll_rows")
      .select("*")
      .eq("deal_id", args.dealId)
      .eq("bank_id", args.bankId);

    if (rrRes.error) {
      throw new Error(`deal_rent_roll_rows_select_failed:${rrRes.error.message}`);
    }
    rentRollRows = (rrRes.data ?? []) as any;
  }

  const renderedBase = template.render({
    dealId: args.dealId,
    bankId: args.bankId,
    facts: (factsRes.data ?? []) as any,
    rentRollRows,
    ownerEntityId: args.ownerEntityId ?? null,
  });

  const rendered: RenderedSpread = {
    ...(renderedBase as any),
    spread_type: args.spreadType,
    status: "ready",
    generatedAt: new Date().toISOString(),
  };

  const { data: upsertedSpread, error } = await (sb as any)
    .from("deal_spreads")
    .upsert(
      {
        deal_id: args.dealId,
        bank_id: args.bankId,
        spread_type: args.spreadType,
        spread_version: template.version,
        owner_type: args.ownerType ?? "DEAL",
        owner_entity_id: args.ownerEntityId ?? SENTINEL_UUID,
        status: "ready",
        inputs_hash: null,
        rendered_json: rendered,
        rendered_html: null,
        rendered_csv: null,
        error: null,
        error_code: null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,bank_id,spread_type,spread_version,owner_type,owner_entity_id" } as any,
    )
    .select("id")
    .maybeSingle();

  if (error) throw new Error(`deal_spreads_upsert_failed:${error.message}`);

  // Fire-and-forget: reconcile Aegis findings now that spread is ready
  reconcileAegisFindingsForSpread({
    dealId: args.dealId,
    bankId: args.bankId,
    spreadType: args.spreadType,
    newStatus: "ready",
  }).catch(() => {});

  // ── Write normalized line items to deal_spread_line_items (best-effort) ──
  try {
    await writeSpreadLineItems({
      sb,
      dealId: args.dealId,
      bankId: args.bankId,
      spreadType: args.spreadType,
      ownerType: args.ownerType ?? "DEAL",
      ownerEntityId: args.ownerEntityId ?? SENTINEL_UUID,
      rendered,
      dealSpreadId: upsertedSpread?.id ?? null,
    });
  } catch (lineItemErr) {
    // Non-fatal: spread is already persisted, line items are supplemental
    console.error("[renderSpread] writeSpreadLineItems failed:", lineItemErr);
  }

  return { ok: true as const };
}

/**
 * Flatten a RenderedSpread into deal_spread_line_items rows.
 * Each (row × column) pair becomes one line item.
 */
async function writeSpreadLineItems(args: {
  sb: any;
  dealId: string;
  bankId: string;
  spreadType: SpreadType;
  ownerType: string;
  ownerEntityId: string | null;
  rendered: RenderedSpread;
  dealSpreadId: string | null;
}) {
  const { sb, dealId, bankId, spreadType, ownerType, ownerEntityId, rendered, dealSpreadId } = args;
  const columns = rendered.columnsV2 ?? [];
  if (!columns.length || !rendered.rows?.length) return;

  // Delete existing line items for this spread type + owner (idempotent re-render)
  let delQ = sb
    .from("deal_spread_line_items")
    .delete()
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("spread_type", spreadType)
    .eq("owner_type", ownerType);
  if (ownerEntityId) {
    delQ = delQ.eq("owner_entity_id", ownerEntityId);
  } else {
    delQ = delQ.is("owner_entity_id", null);
  }
  await delQ;

  const lineItems: any[] = [];
  let sortOrder = 0;

  for (const row of rendered.rows) {
    const cell = row.values?.[0];
    const isV2Cell = cell && typeof cell === "object" && "valueByCol" in cell;

    for (const col of columns) {
      sortOrder += 1;
      const valueNum = isV2Cell ? (cell as any).valueByCol?.[col.key] ?? null : null;
      if (valueNum === null) continue; // skip empty cells

      lineItems.push({
        deal_id: dealId,
        bank_id: bankId,
        spread_type: spreadType,
        owner_type: ownerType,
        owner_entity_id: ownerEntityId,
        deal_spread_id: dealSpreadId,
        section: row.section ?? "",
        line_key: row.key,
        label: row.label,
        sort_order: sortOrder,
        period_label: col.key,
        value_num: typeof valueNum === "number" ? valueNum : null,
        value_text: typeof valueNum === "string" ? valueNum : null,
        is_formula: Boolean(row.formula),
        formula_expr: row.formula ?? null,
        provenance: isV2Cell ? (cell as any).provenanceByCol?.[col.key] ?? null : null,
      });
    }
  }

  if (!lineItems.length) return;

  // Insert in batches of 500 to avoid payload limits
  const BATCH_SIZE = 500;
  for (let i = 0; i < lineItems.length; i += BATCH_SIZE) {
    const batch = lineItems.slice(i, i + BATCH_SIZE);
    const { error: insertErr } = await sb
      .from("deal_spread_line_items")
      .insert(batch);
    if (insertErr) {
      console.error("[writeSpreadLineItems] insert batch failed:", insertErr.message);
    }
  }
}
