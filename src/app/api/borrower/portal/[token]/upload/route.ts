import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeMatch } from "@/lib/uploads/autoMatch";
import { requireValidInvite } from "@/lib/portal/auth";
import { recordLearningEvent } from "@/lib/packs/recordLearningEvent";
import { logDealDocumentReceipt } from "@/lib/deals/docReceipts";
import { inferDocTypeAndYear } from "@/lib/uploads/docTypeHeuristics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadResult = {
  ok: boolean;
  filename: string;
  storage_path?: string;
  matched: boolean;
  match?: any;
  error?: string;
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const invite = await requireValidInvite(token);
    const bank_id = invite.bank_id;
    const deal_id = invite.deal_id;

    const form = await req.formData();

    // Support:
    // - single: form.get("file")
    // - multi: form.getAll("files")
    const single = form.get("file") as File | null;
    const multi = form.getAll("files") as unknown[];

    const files: File[] = [];
    if (single) files.push(single);
    for (const x of multi) {
      if (x instanceof File) files.push(x);
    }

    if (files.length === 0) throw new Error("missing_file");

    const hinted_doc_type =
      (form.get("hinted_doc_type") as string | null) || null;
    const hinted_category =
      (form.get("hinted_category") as string | null) || null;

    // requests (once)
    const reqsRes = await sb
      .from("borrower_document_requests")
      .select("id, title, category, doc_type, status")
      .eq("deal_id", deal_id);

    if (reqsRes.error) throw new Error(reqsRes.error.message);

    const requestRows = (reqsRes.data || []) as any[];

    // Storage bucket/path
    const bucket = "borrower-uploads";

    // Canonical rule: never auto-attach below threshold
    const CONFIDENCE_THRESHOLD = 85;

    const results: UploadResult[] = [];

    for (const file of files) {
      try {
        const bytes = file.size;
        const mime = file.type || null;
        const filename = file.name || "upload";

        const safeName = filename.replaceAll("/", "_");
        const path = `${bank_id}/${deal_id}/${Date.now()}_${Math.random().toString(16).slice(2)}_${safeName}`;

        const buf = Buffer.from(await file.arrayBuffer());
        const up = await sb.storage.from(bucket).upload(path, buf, {
          contentType: mime || "application/octet-stream",
          upsert: false,
        });
        if (up.error) throw new Error(up.error.message);

        // Create inbox row
        const inboxIns = await sb
          .from("borrower_upload_inbox")
          .insert({
            bank_id,
            deal_id,
            storage_path: path,
            filename,
            mime,
            bytes,
            hinted_doc_type,
            hinted_category,
            status: "unmatched",
          })
          .select("*")
          .single();

        if (inboxIns.error) throw new Error(inboxIns.error.message);
        const inbox = inboxIns.data;

        // compute match
        const match = computeMatch(
          { id: inbox.id, deal_id, hinted_doc_type, hinted_category, filename },
          requestRows as any,
        );

        if (match.requestId && match.confidence >= CONFIDENCE_THRESHOLD) {
          const now = new Date().toISOString();

          const updReq = await sb
            .from("borrower_document_requests")
            .update({
              status: "received",
              received_storage_path: path,
              received_filename: filename,
              received_mime: mime,
              received_at: now,
              updated_at: now,
              evidence: {
                auto_matched: true,
                match_confidence: match.confidence,
                match_reason: match.reason,
              },
            })
            .eq("id", match.requestId);

          if (updReq.error) throw new Error(updReq.error.message);

          const updInbox = await sb
            .from("borrower_upload_inbox")
            .update({
              matched_request_id: match.requestId,
              match_confidence: match.confidence,
              match_reason: match.reason,
              status: "attached",
            })
            .eq("id", inbox.id);

          if (updInbox.error) throw new Error(updInbox.error.message);

          const matchEventIns = await sb
            .from("borrower_pack_match_events")
            .insert({
              bank_id,
              deal_id,
              upload_inbox_id: inbox.id,
              request_id: match.requestId,
              confidence: match.confidence,
              matched: true,
            })
            .select("id")
            .single();

          if (matchEventIns.data?.id) {
            await recordLearningEvent(sb, {
              bankId: bank_id,
              matchEventId: matchEventIns.data.id,
              eventType: "upload_matched",
              metadata: {
                filename,
                doc_type: hinted_doc_type,
                category: hinted_category,
                confidence: match.confidence,
                reason: match.reason,
              },
            });
          }

          // NEW: Log document receipt -> triggers borrower timeline event
          const inferred = inferDocTypeAndYear(filename);
          const docType = hinted_doc_type || inferred.docType;
          const docYear = inferred.docYear;

          await logDealDocumentReceipt({
            dealId: deal_id,
            fileName: filename,
            docType,
            docYear,
            source: "portal",
            receivedBy: null, // borrower upload has no banker userId
          }).catch(() => null); // soft-fail to not break upload flow

          results.push({
            ok: true,
            filename,
            storage_path: path,
            matched: true,
            match,
          });
        } else {
          await sb
            .from("borrower_upload_inbox")
            .update({
              matched_request_id: match.requestId,
              match_confidence: match.confidence,
              match_reason: match.reason,
              status: "unmatched",
            })
            .eq("id", inbox.id);

          const matchEventIns = await sb
            .from("borrower_pack_match_events")
            .insert({
              bank_id,
              deal_id,
              upload_inbox_id: inbox.id,
              request_id: match.requestId,
              confidence: match.confidence,
              matched: false,
            })
            .select("id")
            .single();

          if (matchEventIns.data?.id) {
            await recordLearningEvent(sb, {
              bankId: bank_id,
              matchEventId: matchEventIns.data.id,
              eventType: "upload_missed",
              metadata: {
                filename,
                doc_type: hinted_doc_type,
                category: hinted_category,
                confidence: match.confidence,
                reason: match.reason,
                threshold: CONFIDENCE_THRESHOLD,
              },
            });
          }

          results.push({
            ok: true,
            filename,
            storage_path: path,
            matched: false,
            match,
          });
        }
      } catch (e: any) {
        results.push({
          ok: false,
          filename: (file?.name as string) || "upload",
          matched: false,
          error: e?.message || "upload_failed",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      count: results.length,
      results,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "upload_failed" },
      { status: 400 },
    );
  }
}
