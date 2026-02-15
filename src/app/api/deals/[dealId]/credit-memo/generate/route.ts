import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { aiJson } from "@/lib/ai/openai";
import { recordAiEvent } from "@/lib/ai/audit";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Pull top doc intel + ownership + discovery summaries (adjust selectors as needed)
  const [docs, owners, disc] = await Promise.all([
    sb
      .from("doc_intel_results")
      .select(
        "file_id, doc_type, tax_year, extracted_json, evidence_json, confidence, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(20),
    sb.from("ownership_entities").select("*").eq("deal_id", dealId).limit(50),
    sb
      .from("credit_discovery_sessions")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle(),
  ]);

  if (docs.error) throw docs.error;
  if (owners.error) throw owners.error;
  if (disc.error) throw disc.error;

  const schemaHint = `{
    "title":"Credit Memo",
    "body_md":"# Credit Memo\\n...",
    "blocks":[
      {
        "block_id":"b1",
        "label":"string",
        "citations":[
          {
            "attachment_id":"uuid",
            "page_number": null,
            "global_char_start": 0,
            "global_char_end": 0,
            "label":"string",
            "confidence": 80
          }
        ]
      }
    ],
    "confidence": 75
  }`;

  const system =
    "You are a senior credit officer writing a concise credit memo in Markdown. " +
    "CRITICAL: Every major factual claim MUST include at least one citation referencing an attachment_id and global_char_start/global_char_end offsets into OCR text if available. " +
    "If you do not have offsets, set them to 0 and still include attachment_id. " +
    "Return blocks[] where each block corresponds to a paragraph/section and lists citations.";

  const user = JSON.stringify({
    dealId,
    discovery: disc.data,
    ownership: owners.data,
    docs: docs.data,
  });

  const ai = await aiJson<any>({
    scope: "credit_memo",
    action: "generate_with_citations",
    system,
    user,
    jsonSchemaHint: schemaHint,
  });

  await recordAiEvent({
    deal_id: dealId,
    scope: "credit_memo",
    action: "generate_with_citations",
    input_json: { dealId },
    output_json: ai.ok ? ai.result : { error: ai.error },
    confidence: ai.ok
      ? Number(ai.result?.confidence ?? ai.confidence ?? 50)
      : null,
    evidence_json: ai.ok ? { blocks: ai.result?.blocks ?? [] } : null,
    requires_human_review: true,
  });

  if (!ai.ok) {
    await logPipelineLedger(sb, {
      bank_id: bankId,
      deal_id: dealId,
      event_key: "credit_memo_generation_failed",
      status: "error",
      payload: { error: ai.error },
    });
    return NextResponse.json({ ok: false, error: ai.error }, { status: 500 });
  }

  // Insert memo
  const memoIns = await sb
    .from("credit_memo_drafts")
    .insert({
      deal_id: dealId,
      version: 1,
      title: ai.result?.title || "Credit Memo",
      body_md: ai.result?.body_md || "",
    })
    .select("id, deal_id, title, body_md")
    .single();

  if (memoIns.error) throw memoIns.error;
  const memoId = memoIns.data.id as string;

  // Insert citations
  const blocks = Array.isArray(ai.result?.blocks) ? ai.result.blocks : [];
  const rows: any[] = [];
  for (const b of blocks) {
    const blockId = String(b.block_id || "");
    const citations = Array.isArray(b.citations) ? b.citations : [];
    for (const c of citations) {
      rows.push({
        deal_id: dealId,
        memo_draft_id: memoId,
        block_id: blockId || "block",
        attachment_id: c.attachment_id,
        page_number: c.page_number ?? null,
        global_char_start: Number(c.global_char_start || 0),
        global_char_end: Number(c.global_char_end || 0),
        label: c.label ?? null,
        confidence: c.confidence ?? null,
      });
    }
  }

  if (rows.length) {
    const citIns = await sb.from("credit_memo_citations").insert(rows);
    if (citIns.error) throw citIns.error;
  }

  await logPipelineLedger(sb, {
    bank_id: bankId,
    deal_id: dealId,
    event_key: "credit_memo_generated",
    status: "ok",
    payload: { memo_id: memoId, version: 1, blocks_count: blocks.length, citations_count: rows.length },
  });

  return NextResponse.json({ ok: true, memo: memoIns.data, memoId });
}
