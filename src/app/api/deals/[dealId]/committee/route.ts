import { NextRequest, NextResponse } from "next/server";
import { retrieveTopChunks } from "@/lib/retrieval/retrieve";
import { committeeAnswer } from "@/lib/retrieval/committee";
import { insertAiEvent, insertAiCitations } from "@/lib/ai/trace";
import { OPENAI_CHAT } from "@/lib/ai/models";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import {
  AuthorizationError,
  requireRoleApi,
} from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

type Params = Promise<{ dealId: string }>;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_QUESTION_LENGTH = 4_000;

export async function POST(req: NextRequest, context: { params: Params }) {
  try {
    const { dealId } = await context.params;
    const access = await requireDealAccess(dealId);
    const body = await req.json().catch(() => ({}));
    const question = String(body?.question || "").trim();
    const debug = Boolean(body?.debug);

    if (!question || question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { ok: false, error: "invalid_question" },
        { status: 400, headers: NO_STORE },
      );
    }

    // Debug output contains raw retrieved evidence. It is therefore restricted
    // to the platform super-admin role even after ordinary deal access passes.
    if (debug) {
      await requireRoleApi(["super_admin"]);
    }

    const retrieved = await retrieveTopChunks({ dealId, question, k: 20 });
    const result = await committeeAnswer({ dealId, question, retrieved, debug });

    // The answer is not acknowledged until its event and citations are durable.
    const aiEventId = await insertAiEvent({
      deal_id: dealId,
      bank_id: access.bankId,
      kind: "committee.answer",
      model: process.env.OPENAI_CHAT_MODEL || OPENAI_CHAT,
      input: { question, dealId },
      output: result,
      meta: { retrieved_k: retrieved.length },
    });

    await insertAiCitations(
      result.citations.map((citation) => ({
        ai_event_id: aiEventId,
        deal_id: dealId,
        bank_id: access.bankId,
        source_kind: "deal_doc_chunk" as const,
        chunk_id: citation.chunk_id,
        upload_id: citation.upload_id || null,
        excerpt: citation.snippet,
        similarity:
          typeof citation.similarity === "number"
            ? citation.similarity
            : null,
        page_start: citation.page_start ?? null,
        page_end: citation.page_end ?? null,
        document_id: citation.document_id ?? null,
        page_number: citation.page_number ?? null,
        bbox: citation.bbox ?? null,
      })),
    );

    return NextResponse.json(
      { ok: true, ...result, ai_event_id: aiEventId },
      { headers: NO_STORE },
    );
  } catch (error: unknown) {
    rethrowNextErrors(error);
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.code },
        {
          status: error.code === "not_authenticated" ? 401 : 403,
          headers: NO_STORE,
        },
      );
    }

    console.error("[committee POST]", error);
    return NextResponse.json(
      { ok: false, error: "committee_answer_unavailable" },
      { status: 500, headers: NO_STORE },
    );
  }
}
